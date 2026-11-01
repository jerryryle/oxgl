// Runs one conformance page in a jsdom window and reports it to the parent
// over IPC, then exits. Usage (from the parent): fork(page.mjs, [url, options])
// where options is JSON: { endEarly: boolean, root?: string }, root being the
// directory the parent serves.
//
// Messages: { type: 'error', message } at the page's first escaped error;
// { type: 'counts', passed, failed } as results arrive (throttled);
// { type: 'outcome', ... } once the page completes or, when it ends early on
// errors, at that first error; { type: 'harness-error', message } when the
// runner itself fails. A page that never completes sends
// nothing: the parent's time limit decides it.
import { appendFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import jsdom from 'jsdom';

import { resolveFile } from './server.mjs';
import { describe, installShim, keepImageBytes, release } from './window.mjs';

const { JSDOM, VirtualConsole } = jsdom;

// jsdom gives a frame a new window each time it navigates, through this
// module's createWindow, and offers no public hook for it.
const jsdomWindow = createRequire(import.meta.url)('jsdom/lib/jsdom/browser/Window.js');

/**
 * Runs the page at `url`. `hooks.beforeParse(window)` runs after the shim is
 * installed and `hooks.beforeExit()` after the outcome is sent; the runner's
 * own tests use them to inject faults.
 */
export async function runPage(url, { endEarly = false, root } = {}, hooks = {}) {
  const state = {
    root: root === undefined ? undefined : resolve(root),
    passed: 0,
    failed: 0,
    firstFailure: undefined,
    error: undefined,
    contextErrors: [],
    contexts: new Set(),
    errorBeforeFailure: false,
  };
  let finished = false;
  let pageWindow;
  let countsTimer;
  let countsSentAt = -Infinity;

  // Counts reach the parent promptly but at most every 250 ms. They keep a
  // page that later times out or crashes on record, and each one restarts the
  // parent's watchdog, as each result does in the official harness. They are
  // sent from the reporting call itself, not only from a timer, so a page
  // reporting inside a long synchronous stretch, which no timer can
  // interrupt, still restarts the watchdog; the timer sends the last counts.
  const postCounts = () => {
    clearTimeout(countsTimer);
    countsTimer = undefined;
    countsSentAt = performance.now();
    process.send?.({ type: 'counts', passed: state.passed, failed: state.failed });
  };
  const sendCounts = () => {
    const wait = countsSentAt + 250 - performance.now();
    if (wait <= 0) postCounts();
    else countsTimer ??= setTimeout(postCounts, wait);
  };

  const finish = (outcome, message) => {
    if (finished) return;
    finished = true;
    clearTimeout(countsTimer);
    // Stop the page's timers and scripts, then release its contexts and any
    // its frames still hold.
    pageWindow?.close();
    for (const ref of state.contexts) release(state, ref);
    process.send?.(
      {
        type: 'outcome',
        outcome,
        passed: state.passed,
        failed: state.failed,
        message,
        error: state.error,
        errorBeforeFailure: state.errorBeforeFailure,
        contextErrors: state.contextErrors,
      },
      () => {
        hooks.beforeExit?.();
        process.exit(0);
      },
    );
  };

  const onError = (message) => {
    if (state.error !== undefined || finished) return;
    state.error = message;
    state.errorBeforeFailure = state.failed === 0;
    // Sent now, so a page that then never completes still has it on record.
    process.send?.({ type: 'error', message });
    if (endEarly) finish('FAIL', message);
  };

  // The IPC channel does not keep a child alive on its own; hold it open so a
  // page that goes idle without completing waits for the parent's time limit.
  process.channel?.ref();

  // Rejections in the page's realm reach Node's process-wide handling, whose
  // default ends the process. Browsers, and the official harness, ignore
  // them; so does this runner. The runner's own async work is awaited.
  // OXGL_CONFORMANCE_TRACE records them, a debugging aid for pages that hang.
  process.on('unhandledRejection', (reason) => {
    const trace = process.env.OXGL_CONFORMANCE_TRACE;
    if (trace) appendFileSync(trace, `UNHANDLED REJECTION: ${describe(reason)}\n`);
  });

  // Frames the page opens get the same shim before their documents parse,
  // and a console of their own: as in the official harness, a frame's
  // uncaught errors, like its results, are not the page's.
  const shim = (window) => {
    installShim(window, state);
    if (state.root !== undefined) window.CLOSURE_IMPORT_SCRIPT = closureImport(window, state.root);
  };
  const createWindow = jsdomWindow.createWindow;
  if (typeof createWindow !== 'function') throw new Error('jsdom no longer exports createWindow; update the frame shim');
  const frameConsole = new VirtualConsole();
  jsdomWindow.createWindow = (options) => {
    const frameWindow = createWindow({ ...options, settings: { ...options.settings, virtualConsole: frameConsole } });
    shim(frameWindow);
    return frameWindow;
  };

  // Only the page's own document reports to the harness, as in the official
  // harness, where a test page's frames have no webglTestHarness above them.
  const isPage = (url) => url === pageWindow?.location.pathname;

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => {
    if (error.type === 'unhandled-exception') onError(describe(error.cause ?? error));
  });

  await JSDOM.fromURL(url, {
    runScripts: 'dangerously',
    resources: { interceptors: [keepImageBytes] },
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      pageWindow = window;
      shim(window);
      window.webglTestHarness = {
        reportResults(url, success, msg) {
          if (finished || !isPage(url)) return;
          if (success) state.passed += 1;
          else {
            state.failed += 1;
            state.firstFailure ??= String(msg);
            // A debugging aid: OXGL_CONFORMANCE_TRACE names a file that
            // collects every failed assertion, not only the first.
            const trace = process.env.OXGL_CONFORMANCE_TRACE;
            if (trace) appendFileSync(trace, `FAILED ${url}: ${String(msg)}\n${String(new Error().stack)}\n`);
          }
          sendCounts();
        },
        notifyFinished(url) {
          if (!isPage(url)) return;
          if (state.failed > 0) finish('FAIL', state.firstFailure);
          else if (state.passed === 0) finish('FAIL', state.error ?? 'no results reported');
          else finish('PASS', undefined);
        },
      };
      hooks.beforeParse?.(window);
    },
  });
}

/**
 * Closure's uncompiled loader (deqp's goog.require) imports each file with
 * document.write. jsdom queues those scripts behind the ones the parser has
 * already queued, so a page's later scripts would run before its imports; a
 * browser runs them before parsing goes on. Closure's import hook runs each
 * file at once instead, read from the served directory, as an inline script:
 * jsdom runs that synchronously and reports its errors as the page's.
 * Returns false, so nothing loads, for source text (goog.module, which the
 * suite does not use), another origin, or a file outside `root` or missing.
 */
function closureImport(window, root) {
  return (src, text) => {
    const url = new URL(src, window.location.href);
    if (text !== undefined || url.origin !== window.location.origin) return false;
    const file = resolveFile(root, url.href);
    if (file === undefined) return false;
    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      return false;
    }
    const script = window.document.createElement('script');
    script.text = `${source}\n//# sourceURL=${url.href}`;
    window.document.head.appendChild(script);
    return true;
  };
}

/** The child's entry point: runs the page named on the command line. */
export async function main(hooks = {}) {
  const [url, options = '{}'] = process.argv.slice(2);
  try {
    await runPage(url, JSON.parse(options), hooks);
  } catch (error) {
    process.send?.({ type: 'harness-error', message: describe(error) }, () => process.exit(1));
  }
}

if (import.meta.main) await main();
