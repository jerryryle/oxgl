// Runs pages through a fixed pool of child processes, one fresh process per
// page, and classifies each page from how its process ended.
import { fork } from 'node:child_process';
import { availableParallelism, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';

import { SUITES } from './lists.mjs';

export const PAGE_SCRIPT = fileURLToPath(new URL('page.mjs', import.meta.url));

/** Memory one page may need: shader-heavy pages peak near 500 MiB on SwiftShader. */
const PAGE_MEMORY = 1024 ** 3;

/**
 * One page per CPU, as pages are mostly single-threaded startup
 * (conformance-all-cores), but no more than memory holds: a swapping
 * machine stalls pages past their time limit.
 */
export function defaultJobs() {
  const memory = Math.min(totalmem(), process.constrainedMemory() || Infinity);
  return Math.max(1, Math.min(availableParallelism(), Math.floor(memory / PAGE_MEMORY)));
}

/** The URL a suite's page loads from: `webglVersion` selects the context version, as in the official harness. */
export function pageURL(origin, suite, path) {
  const url = new URL(path, `${origin}/`);
  url.searchParams.set('webglVersion', String(SUITES[suite]));
  return url.href;
}

/**
 * Runs `pages` ({ suite, path, expected }), timing each out when it goes
 * `timeoutMs` without a new result, or runs `totalMs` in all when that is
 * set, and resolves to one record per page, in order: `{ suite, path,
 * expected, outcome, passed, failed, message, error, errorBeforeFailure,
 * contextErrors, extra, durationMs, maxGapMs, limit }`, or `{ suite, path,
 * expected, harnessError, durationMs }`. `maxGapMs` is the longest time the
 * page went without a result; `limit` is `'idle'` or `'total'` for a
 * `TIMEOUT`. `args(page, endEarly)` gives a page process its arguments
 * (by default a Khronos page's URL and options) and `execArgv` its extra
 * Node options.
 */
export async function runPages(
  pages,
  {
    origin,
    root,
    jobs = defaultJobs(),
    timeoutMs,
    totalMs,
    teardownMs = TEARDOWN_MS,
    fastErrors = false,
    script = PAGE_SCRIPT,
    args = (page, endEarly) => [pageURL(origin, page.suite, page.path), JSON.stringify({ endEarly, root })],
    execArgv = [],
    onResult,
  },
) {
  const results = new Array(pages.length);
  let next = 0;
  const worker = async () => {
    while (next < pages.length) {
      const index = next;
      next += 1;
      const page = pages[index];
      const endEarly = fastErrors || page.expected === 'FAIL';
      const result = await runOne(script, args(page, endEarly), { execArgv, timeoutMs, totalMs, teardownMs });
      results[index] = { suite: page.suite, path: page.path, expected: page.expected, ...result };
      onResult?.(results[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
  return results;
}

const STDERR_TAIL = 4096;
/** Time a page that has reported its outcome gets to tear down and exit. */
export const TEARDOWN_MS = 30_000;

function runOne(script, args, { execArgv, timeoutMs, totalMs, teardownMs }) {
  const started = performance.now();
  return new Promise((done) => {
    const child = fork(script, args, { execArgv: [...process.execArgv, ...execArgv], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let message;
    let stderr = '';
    let timedOut;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });
    let pageError;
    let counts;
    let teardownHung = false;
    const kill = (limit) => {
      if (message?.type === 'outcome') teardownHung = true;
      else timedOut = limit;
      child.kill('SIGKILL');
    };
    let timer = setTimeout(kill, timeoutMs, 'idle');
    const total = totalMs === undefined ? undefined : setTimeout(kill, totalMs, 'total');
    let lastResultAt = started;
    let maxGapMs = 0;
    const result = () => {
      const now = performance.now();
      maxGapMs = Math.max(maxGapMs, Math.round(now - lastResultAt));
      lastResultAt = now;
    };
    child.on('message', (m) => {
      if (m?.type === 'error') pageError ??= m.message;
      else if (m?.type === 'counts') {
        counts = m;
        result();
        // The watchdog: each result restarts the time limit.
        if (message?.type !== 'outcome') {
          clearTimeout(timer);
          timer = setTimeout(kill, timeoutMs, 'idle');
        }
      } else {
        message ??= m;
        // The page completed; its teardown gets its own limit, so finishing
        // just before the time limit is not a TIMEOUT.
        if (m?.type === 'outcome') {
          result();
          clearTimeout(timer);
          clearTimeout(total);
          timer = setTimeout(kill, teardownMs);
        }
      }
    });
    child.on('error', (error) => {
      // Only a failed spawn lands here; 'close' may not follow, and a later
      // one resolves the settled promise to no effect.
      clearTimeout(timer);
      clearTimeout(total);
      done({ harnessError: `could not start the page process: ${error.message}`, durationMs: 0 });
    });
    // 'close', not 'exit': 'exit' can fire before the parent has read the
    // child's last IPC messages, so a page that sent its outcome and exited
    // would count as exiting without one.
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(total);
      const durationMs = Math.round(performance.now() - started);
      const reported = message?.type === 'outcome' ? message : undefined;
      const details = {
        passed: reported?.passed ?? counts?.passed ?? 0,
        failed: reported?.failed ?? counts?.failed ?? 0,
        error: reported?.error ?? pageError,
        errorBeforeFailure: reported?.errorBeforeFailure ?? false,
        contextErrors: reported?.contextErrors ?? [],
        // Fields a runner's own page script reports, passed on as they are.
        extra: reported?.extra,
        durationMs,
        maxGapMs,
      };
      if (timedOut === 'idle') {
        done({ outcome: 'TIMEOUT', message: `no new result for ${timeoutMs / 1000} s`, limit: 'idle', ...details });
      } else if (timedOut === 'total') {
        done({ outcome: 'TIMEOUT', message: `ran ${totalMs / 1000} s in total`, limit: 'total', ...details });
      } else if (teardownHung) {
        const after = `reported ${reported?.outcome}, then did not exit within ${teardownMs / 1000} s`;
        done({ outcome: 'CRASH', message: [after, stderr.trim()].filter(Boolean).join('\n'), ...details });
      } else if (signal !== null || isNativeAbort(code)) {
        const how = signal !== null ? `killed by ${signal}` : `exited with code ${code}`;
        done({ outcome: 'CRASH', message: [how, stderr.trim()].filter(Boolean).join('\n'), ...details });
      } else if (message?.type === 'harness-error') {
        done({ harnessError: message.message, durationMs });
      } else if (reported && code === 0) {
        done({ outcome: reported.outcome, message: reported.message, ...details });
      } else {
        done({ harnessError: `page process exited with code ${code} without an outcome\n${stderr.trim()}`, durationMs });
      }
    });
  });
}

/**
 * Windows reports a native abort as exit code 3, an unhandled exception as a
 * 0xC… status, and Node's own abort (`process.abort()`, failed assertions) as
 * 134, its `ExitCode::kAbort`: Node's `ABORT()` ends in `_exit(134)` there.
 */
function isNativeAbort(code) {
  return process.platform === 'win32' && code !== null && (code === 3 || code === 134 || code >>> 0 >= 0xc0000000);
}
