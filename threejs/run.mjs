// `npm run threejs`: runs the pinned three.js release's examples against
// dist/, judges each frame against threejs/expectations.txt and writes
// threejs-results.json, with failing examples' images in threejs-output/.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { applicable, concludeRun, DEFAULT_TOLERANCE, formatExpectations, hostPlatform, keyOf, parseExpectations, selectPages } from '../conformance/expectations.mjs';
import { defaultJobs, runPages } from '../conformance/pool.mjs';
import { requireCanvas, requireFfmpeg } from '../conformance/run.mjs';
import { REPO_ROOT } from '../conformance/suite.mjs';

import { ensureRelease, listExamples, readPin } from './release.mjs';

export const EXPECTATIONS_PATH = join(REPO_ROOT, 'threejs', 'expectations.txt');
export const REPORT_PATH = join(REPO_ROOT, 'threejs-results.json');
export const OUTPUT_DIR = join(REPO_ROOT, 'threejs-output');
export const EXAMPLE_SCRIPT = fileURLToPath(new URL('example.mjs', import.meta.url));
/** The suite's name in expectations entries and the report. */
export const SUITE = 'threejs';
/** Seconds an example may go without progress. */
const DEFAULT_TIMEOUT_S = 60;
/** Seconds an example may run in all: upstream's network timeout. */
const DEFAULT_TOTAL_TIMEOUT_S = 300;

const HEADER = [
  '# three.js examples not expected to pass: <example> <OUTCOME> [<platform> ...] # <reason>, where OUTCOME',
  '# is FAIL, TIMEOUT, CRASH, SKIP, or DIFF <p>% (passes with up to p% of pixels differing, 0.1 < p <= 5).',
  '# An entry without platforms applies everywhere. An example without an entry that applies is expected to',
  '# PASS. See CONTRIBUTING.md; `npm run threejs -- --update` rewrites this file.',
];
const FORMAT = { suite: SUITE, tolerances: true };

/** Parses the three.js expectations file's text. */
export function parseThreejsExpectations(text, source = EXPECTATIONS_PATH) {
  return parseExpectations(text, source, FORMAT);
}

/**
 * Runs `examples` (names) from the checkout `root` and judges them against
 * `expectations`. Always writes the report; with `update`, also writes the
 * expectations to `expectationsPath`. Resolves to `{ ok, report }`.
 */
export async function runThreejs({
  root,
  examples,
  expectations,
  pin,
  filter,
  includeSkipped = false,
  update = false,
  timeoutS = DEFAULT_TIMEOUT_S,
  totalTimeoutS = DEFAULT_TOTAL_TIMEOUT_S,
  jobs = defaultJobs(),
  script = EXAMPLE_SCRIPT,
  reportPath = REPORT_PATH,
  expectationsPath = EXPECTATIONS_PATH,
  outputDir = OUTPUT_DIR,
  log = console.log,
}) {
  const started = Date.now();
  const pages = new Map([[SUITE, examples]]);
  // The entries that apply on this host: an entry can name platforms.
  const applying = applicable(expectations);
  const selection = selectPages(pages, expectations, { filter, includeSkipped });
  const toRun = selection.run.map((p) => {
    const entry = applying.get(keyOf(p.suite, p.path));
    return { ...p, expected: entry?.outcome ?? 'PASS', tolerance: entry?.outcome === 'DIFF' ? entry.tolerance : DEFAULT_TOLERANCE };
  });
  rmSync(outputDir, { recursive: true, force: true });

  let done = 0;
  const onResult = (r) => {
    done += 1;
    const expected = r.expected === 'DIFF' ? 'PASS' : r.expected;
    if (r.harnessError !== undefined) log(`${r.path}: harness error: ${r.harnessError}`);
    else if (r.expected !== 'SKIP' && r.outcome !== expected) {
      const why = (r.message ?? '').split('\n')[0];
      log(`${r.path}: expected ${expected}, got ${r.outcome}${why ? ` (${why})` : ''}`);
    }
    if (done % 25 === 0) log(`threejs: ${String(done)}/${String(toRun.length)} examples`);
  };

  const records = await runPages(toRun, {
    script,
    args: (page) => [page.path, JSON.stringify({ root, tolerance: page.tolerance, output: outputDir })],
    execArgv: ['--experimental-vm-modules', '--disable-warning=ExperimentalWarning'],
    jobs,
    timeoutMs: timeoutS * 1000,
    totalMs: totalTimeoutS * 1000,
    onResult,
  });

  const harnessErrors = records.filter((r) => r.harnessError !== undefined);
  const results = records
    .filter((r) => r.harnessError === undefined)
    .map((r) => ({ ...r, diffPercent: r.extra?.diffPercent, imageOnly: r.extra?.imageOnly === true }));
  const verdict = concludeRun(expectations, results, pages, {
    filtered: filter !== undefined,
    update,
    harnessErrors: harnessErrors.length,
    tolerances: true,
  });

  const counts = { PASS: 0, FAIL: 0, TIMEOUT: 0, CRASH: 0, SKIP: selection.skipped.length, HARNESS_ERROR: 0 };
  for (const r of records) counts[r.outcome ?? 'HARNESS_ERROR'] += 1;
  const expectedOf = (path) => {
    const entry = applying.get(keyOf(SUITE, path));
    return entry?.outcome === 'DIFF' ? `DIFF ${String(entry.tolerance)}%` : entry?.outcome ?? 'PASS';
  };
  const report = {
    tag: pin.tag,
    commit: pin.commit,
    backend: process.env.OXGL_BACKEND || 'auto',
    // Seconds an example may go without progress, and may run in all.
    idleTimeoutSeconds: timeoutS,
    totalTimeoutSeconds: totalTimeoutS,
    jobs,
    // Named as the expectations and the results page name it (macos-arm64,
    // not darwin-arm64).
    platform: hostPlatform(),
    timestamp: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    options: { filter: filter ?? null, includeSkipped, update },
    ok: verdict.ok,
    counts,
    examples: [
      ...records.map((r) => ({
        name: r.path,
        expected: expectedOf(r.path),
        // For the results page (openspec results-page).
        reason: applying.get(keyOf(SUITE, r.path))?.reason ?? null,
        outcome: r.outcome ?? 'HARNESS_ERROR',
        diffPercent: r.extra?.diffPercent ?? null,
        durationMs: r.durationMs,
        maxGapMs: r.maxGapMs ?? null,
        limit: r.limit ?? null,
        message: r.message ?? r.harnessError ?? null,
        error: r.error ?? null,
        refused: r.extra?.refused ?? null,
        contextErrors: r.contextErrors ?? [],
      })),
      ...selection.skipped.map((s) => ({ name: s.path, expected: 'SKIP', reason: applying.get(keyOf(SUITE, s.path))?.reason ?? null, outcome: 'SKIP' })),
    ],
    unexpected: verdict.unexpected.map((u) => ({ name: u.path, expected: u.expected, outcome: u.outcome, diffPercent: u.diffPercent ?? null })),
    stale: verdict.stale.map((e) => ({ name: e.path, outcome: e.outcome })),
    harnessErrors: harnessErrors.map((h) => ({ name: h.path, message: h.harnessError })),
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (verdict.written) writeFileSync(expectationsPath, formatExpectations(verdict.written, { suite: SUITE, header: HEADER }));

  for (const e of verdict.stale) log(`${e.path}: stale ${e.outcome} entry; the release has no such example`);
  const summary = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${String(n)} ${k}`).join(', ');
  log(`threejs: ${summary || 'no examples'}`);
  if (verdict.written) log(`updated ${expectationsPath}`);
  log(`${verdict.ok ? 'threejs: ok' : 'threejs: FAILED'}; report in ${reportPath}`);
  return { ok: verdict.ok, report };
}

const USAGE = `usage: npm run threejs -- [--filter <substring>] [--include-skipped] [--update]
  [--timeout <seconds>] [--total-timeout <seconds>] [--jobs <n>]
--timeout: seconds an example may go without progress (default ${String(DEFAULT_TIMEOUT_S)})
--total-timeout: seconds an example may run in all (default ${String(DEFAULT_TOTAL_TIMEOUT_S)})`;

/**
 * The command: parses `argv`, then runs the suite. Resolves to the exit
 * code; throws on bad options or expectations, before fetching anything.
 */
export async function main(
  argv = process.argv.slice(2),
  { expectationsPath = EXPECTATIONS_PATH, fetchRelease = ensureRelease, loadCanvas, hasFfmpeg } = {},
) {
  const { values } = parseArgs({
    args: argv,
    options: {
      filter: { type: 'string' },
      'include-skipped': { type: 'boolean', default: false },
      update: { type: 'boolean', default: false },
      timeout: { type: 'string', default: String(DEFAULT_TIMEOUT_S) },
      'total-timeout': { type: 'string', default: String(DEFAULT_TOTAL_TIMEOUT_S) },
      jobs: { type: 'string', default: String(defaultJobs()) },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const timeoutS = Number(values.timeout);
  const totalTimeoutS = Number(values['total-timeout']);
  const jobs = Number(values.jobs);
  if (!(timeoutS > 0)) throw new Error(`--timeout must be a positive number of seconds\n${USAGE}`);
  if (!(totalTimeoutS > 0)) throw new Error(`--total-timeout must be a positive number of seconds\n${USAGE}`);
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error(`--jobs must be a positive integer\n${USAGE}`);
  if (!existsSync(join(REPO_ROOT, 'dist', 'index.js'))) throw new Error('dist/ is not built; run `npm run build` first');

  requireCanvas(loadCanvas);
  requireFfmpeg(hasFfmpeg);

  // Parse before fetching or running anything, so a bad entry fails fast.
  const expectations = parseThreejsExpectations(readFileSync(expectationsPath, 'utf8'), expectationsPath);
  const pin = readPin();
  const root = fetchRelease(pin);
  const { ok } = await runThreejs({
    root,
    examples: listExamples(root),
    expectations,
    pin,
    filter: values.filter,
    includeSkipped: values['include-skipped'],
    update: values.update,
    timeoutS,
    totalTimeoutS,
    jobs,
    expectationsPath,
  });
  return ok ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`threejs: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
