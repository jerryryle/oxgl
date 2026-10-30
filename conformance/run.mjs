// `npm run conformance`: runs the pinned Khronos suites against dist/, judges
// the outcomes against conformance/expectations.txt and writes
// conformance-results.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { concludeRun, formatExpectations, keyOf, parseExpectations, selectPages } from './expectations.mjs';
import { listPages, SUITES } from './lists.mjs';
import { defaultJobs, runPages } from './pool.mjs';
import { startServer } from './server.mjs';
import { ensureSuite, readPin, REPO_ROOT } from './suite.mjs';
import { ffmpegAvailable } from './video.mjs';

export const EXPECTATIONS_PATH = join(REPO_ROOT, 'conformance', 'expectations.txt');
export const REPORT_PATH = join(REPO_ROOT, 'conformance-results.json');
/** Seconds a page may go without a result: the official harness's watchdog. */
const DEFAULT_TIMEOUT_S = 20;

/**
 * Runs `pages` (suite → page paths under `root`) and judges them against
 * `expectations`. Always writes the report; with `update`, also writes the
 * expectations to `expectationsPath`. Resolves to `{ ok, report }`.
 */
export async function runConformance({
  root,
  pages,
  expectations,
  commit,
  filter,
  includeSkipped = false,
  fastErrors = false,
  update = false,
  timeoutS = DEFAULT_TIMEOUT_S,
  jobs = defaultJobs(),
  script,
  reportPath = REPORT_PATH,
  expectationsPath = EXPECTATIONS_PATH,
  log = console.log,
}) {
  const started = Date.now();
  const selection = selectPages(pages, expectations, { filter, includeSkipped });
  const toRun = selection.run.map((p) => ({ ...p, expected: expectations.get(keyOf(p.suite, p.path))?.outcome ?? 'PASS' }));

  // Report differences as pages finish, so a long run is never silent.
  let done = 0;
  const onResult = (r) => {
    done += 1;
    if (r.harnessError !== undefined) log(`${r.suite} ${r.path}: harness error: ${r.harnessError}`);
    else if (r.expected !== 'SKIP' && r.outcome !== r.expected) {
      const why = (r.message ?? '').split('\n')[0];
      log(`${r.suite} ${r.path}: expected ${r.expected}, got ${r.outcome}${why ? ` (${why})` : ''}`);
    }
    if (done % 100 === 0) log(`conformance: ${done}/${toRun.length} pages`);
  };

  const server = await startServer(root);
  let records;
  try {
    records = await runPages(toRun, {
      origin: server.origin,
      root,
      jobs,
      timeoutMs: timeoutS * 1000,
      fastErrors,
      onResult,
      ...(script === undefined ? {} : { script }),
    });
  } finally {
    await server.close();
  }

  const harnessErrors = records.filter((r) => r.harnessError !== undefined);
  const results = records.filter((r) => r.harnessError === undefined);
  const verdict = concludeRun(expectations, results, pages, {
    filtered: filter !== undefined,
    update,
    harnessErrors: harnessErrors.length,
  });

  const report = {
    commit,
    backend: process.env.OXGL_BACKEND || 'auto',
    // Seconds a page may go without a new result (the watchdog), not a total.
    idleTimeoutSeconds: timeoutS,
    jobs,
    platform: `${process.platform}-${process.arch}`,
    timestamp: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    options: { filter: filter ?? null, includeSkipped, fastErrors, update },
    ok: verdict.ok,
    suites: Object.fromEntries(
      [...pages.keys()].map((suite) => {
        const ran = records.filter((r) => r.suite === suite);
        const skipped = selection.skipped.filter((s) => s.suite === suite);
        const counts = { PASS: 0, FAIL: 0, TIMEOUT: 0, CRASH: 0, SKIP: skipped.length, HARNESS_ERROR: 0 };
        for (const r of ran) counts[r.outcome ?? 'HARNESS_ERROR'] += 1;
        const entries = [
          ...ran.map((r) => ({
            path: r.path,
            expected: r.expected,
            outcome: r.outcome ?? 'HARNESS_ERROR',
            passed: r.passed ?? 0,
            failed: r.failed ?? 0,
            durationMs: r.durationMs,
            maxGapMs: r.maxGapMs ?? null,
            message: r.message ?? r.harnessError ?? null,
            error: r.error ?? null,
            contextErrors: r.contextErrors ?? [],
          })),
          ...skipped.map((s) => ({ path: s.path, expected: 'SKIP', outcome: 'SKIP' })),
        ];
        return [suite, { counts, pages: entries }];
      }),
    ),
    unexpected: verdict.unexpected.map((u) => ({ suite: u.suite, path: u.path, expected: u.expected, outcome: u.outcome })),
    stale: verdict.stale.map((e) => ({ suite: e.suite, path: e.path, outcome: e.outcome })),
    harnessErrors: harnessErrors.map((h) => ({ suite: h.suite, path: h.path, message: h.harnessError })),
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (verdict.written) writeFileSync(expectationsPath, formatExpectations(verdict.written));

  for (const e of verdict.stale) log(`${e.suite} ${e.path}: stale ${e.outcome} entry; the suite has no such page`);
  for (const [suite, { counts }] of Object.entries(report.suites)) {
    const summary = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ');
    log(`${suite}: ${summary || 'no pages'}`);
  }
  if (verdict.written) log(`updated ${expectationsPath}`);
  log(`${verdict.ok ? 'conformance: ok' : 'conformance: FAILED'}; report in ${reportPath}`);
  return { ok: verdict.ok, report };
}

const USAGE = `usage: npm run conformance -- [--suite webgl1|webgl2] [--filter <substring>]
  [--include-skipped] [--fast-errors] [--update] [--timeout <seconds>] [--jobs <n>]
--timeout: seconds a page may go without a new result before it times out (default ${DEFAULT_TIMEOUT_S})`;

/**
 * The command: parses `argv`, then runs the selected suites. Resolves to the
 * exit code; throws on bad options or expectations, before fetching anything.
 */
/**
 * Loads the `canvas` package, which jsdom needs for 2D contexts and images.
 * Without it about 200 pages would fail in the runner rather than in oxgl.
 */
export function requireCanvas(load = () => createRequire(import.meta.url)('canvas')) {
  try {
    load();
  } catch (error) {
    throw new Error(
      `the 'canvas' package (a devDependency jsdom uses for 2D canvases and images) cannot be loaded; run \`npm ci\`: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * Checks for ffmpeg and ffprobe, which decode the pages' videos. Without
 * them the video pages would skip their video cases and pass.
 */
export function requireFfmpeg(available = ffmpegAvailable) {
  if (!available) {
    throw new Error('ffmpeg and ffprobe, which decode the pages\' videos, cannot be run; install ffmpeg (for example `apt-get install ffmpeg`)');
  }
}

export async function main(
  argv = process.argv.slice(2),
  { expectationsPath = EXPECTATIONS_PATH, fetchSuite = ensureSuite, loadCanvas, hasFfmpeg } = {},
) {
  const { values } = parseArgs({
    args: argv,
    options: {
      suite: { type: 'string' },
      filter: { type: 'string' },
      'include-skipped': { type: 'boolean', default: false },
      'fast-errors': { type: 'boolean', default: false },
      update: { type: 'boolean', default: false },
      timeout: { type: 'string', default: String(DEFAULT_TIMEOUT_S) },
      jobs: { type: 'string', default: String(defaultJobs()) },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const timeoutS = Number(values.timeout);
  const jobs = Number(values.jobs);
  if (values.suite !== undefined && !Object.hasOwn(SUITES, values.suite)) throw new Error(`unknown suite ${values.suite}\n${USAGE}`);
  if (!(timeoutS > 0)) throw new Error(`--timeout must be a positive number of seconds\n${USAGE}`);
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error(`--jobs must be a positive integer\n${USAGE}`);
  if (!existsSync(join(REPO_ROOT, 'dist', 'index.js'))) {
    throw new Error('dist/ is not built; run `npm run build` first');
  }

  requireCanvas(loadCanvas);
  requireFfmpeg(hasFfmpeg);

  // Parse before fetching or running anything, so a bad entry fails fast.
  const expectations = parseExpectations(readFileSync(expectationsPath, 'utf8'), expectationsPath);
  const pin = readPin();
  const root = fetchSuite(pin);
  const suites = values.suite === undefined ? Object.keys(SUITES) : [values.suite];
  const pages = new Map(suites.map((suite) => [suite, listPages(root, pin.versions[suite])]));
  const { ok } = await runConformance({
    root,
    pages,
    expectations,
    commit: pin.commit,
    filter: values.filter,
    includeSkipped: values['include-skipped'],
    fastErrors: values['fast-errors'],
    update: values.update,
    timeoutS,
    jobs,
    expectationsPath,
  });
  return ok ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`conformance: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
