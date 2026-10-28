// The checked-in expectations file and how runs are judged against it.
//
// Format, one entry per line: `<suite> <path> <OUTCOME> # <reason>`, with
// blank lines and `#` comment lines allowed. A page without an entry is
// expected to PASS.
import { SUITES } from './lists.mjs';

export const OUTCOMES = ['PASS', 'FAIL', 'TIMEOUT', 'CRASH'];
const ENTRY_OUTCOMES = ['FAIL', 'TIMEOUT', 'CRASH', 'SKIP'];
const REASON_LIMIT = 200;

const HEADER = [
  '# Conformance pages not expected to pass, per suite: <suite> <path> <OUTCOME> # <reason>',
  '# A page without an entry is expected to PASS. See CONTRIBUTING.md; `npm run conformance -- --update`',
  '# rewrites this file.',
];

/** Map key of an entry or result. */
export const keyOf = (suite, path) => `${suite} ${path}`;

/**
 * Parses expectations text into a Map from `keyOf(suite, path)` to
 * `{ suite, path, outcome, reason }`. Throws one error naming every bad line.
 */
export function parseExpectations(text, source = 'expectations.txt') {
  const entries = new Map();
  const errors = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const where = `${source}:${index + 1}`;
    const match = /^(\S+)\s+(\S+)\s+(\S+)(?:\s+#(.*))?$/.exec(line);
    if (!match) {
      errors.push(`${where}: expected "<suite> <path> <OUTCOME> # <reason>"`);
      return;
    }
    const [, suite, path, outcome, rawReason] = match;
    const reason = (rawReason ?? '').trim();
    if (!Object.hasOwn(SUITES, suite)) errors.push(`${where}: unknown suite ${suite}`);
    else if (!ENTRY_OUTCOMES.includes(outcome)) errors.push(`${where}: unknown outcome ${outcome}`);
    else if (reason === '') errors.push(`${where}: ${suite} ${path} has no reason`);
    else if (entries.has(keyOf(suite, path))) errors.push(`${where}: duplicate entry for ${suite} ${path}`);
    else entries.set(keyOf(suite, path), { suite, path, outcome, reason });
  });
  if (errors.length > 0) throw new Error(`invalid expectations:\n  ${errors.join('\n  ')}`);
  return entries;
}

/** Formats entries as expectations text, sorted by suite then path. */
export function formatExpectations(entries) {
  const sorted = [...entries.values()].sort((a, b) =>
    a.suite === b.suite ? compare(a.path, b.path) : compare(a.suite, b.suite),
  );
  const lines = sorted.map((e) => `${e.suite} ${e.path} ${e.outcome} # ${e.reason}`);
  return `${[...HEADER, '', ...lines].join('\n')}\n`;
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Reduces a failure message to one line of at most 200 characters. */
export function normalizeReason(message) {
  const first = (message ?? '').split('\n').find((line) => line.trim() !== '') ?? '';
  return first.replace(/\s+/g, ' ').trim().slice(0, REASON_LIMIT).trim();
}

/** The reason an `--update` run records for a page's result. */
export function reasonFor(result) {
  if (result.outcome === 'TIMEOUT' || result.outcome === 'CRASH') {
    // The limit is a run option, so a reason does not name its value.
    const what = result.outcome === 'TIMEOUT' ? 'no new result within the time limit' : 'crashed';
    return result.error ? normalizeReason(`${what}: ${normalizeReason(result.error)}`) : what;
  }
  // An escaped error before any failure is the cause, and the failures after
  // it (or none at all) are symptoms; otherwise the first failure is.
  const causedByError = result.error !== undefined && (result.errorBeforeFailure || !result.failed);
  return normalizeReason(causedByError ? result.error : result.message) || 'failed';
}

/**
 * Chooses the pages to run: `pages` maps each selected suite to its page
 * list; `filter` keeps paths containing it. SKIP pages are run only with
 * `includeSkipped`; otherwise they are returned in `skipped`.
 */
export function selectPages(pages, expectations, { filter, includeSkipped = false } = {}) {
  const run = [];
  const skipped = [];
  for (const [suite, paths] of pages) {
    for (const path of paths) {
      if (filter !== undefined && !path.includes(filter)) continue;
      const isSkip = expectations.get(keyOf(suite, path))?.outcome === 'SKIP';
      if (isSkip && !includeSkipped) skipped.push({ suite, path });
      else run.push({ suite, path });
    }
  }
  return { run, skipped };
}

/**
 * Judges `results` ({ suite, path, outcome, message }) against
 * `expectations`. `pages` maps the suites that ran to their page lists; stale
 * entries are looked for only in those suites, and only when the run was not
 * filtered. Results of SKIP pages are returned in `unjudged`.
 */
export function judge(expectations, results, pages, { filtered = false } = {}) {
  const unexpected = [];
  const unjudged = [];
  for (const result of results) {
    const entry = expectations.get(keyOf(result.suite, result.path));
    if (entry?.outcome === 'SKIP') {
      unjudged.push(result);
      continue;
    }
    const expected = entry?.outcome ?? 'PASS';
    if (result.outcome !== expected) unexpected.push({ ...result, expected });
  }
  return { unexpected, unjudged, stale: filtered ? [] : staleEntries(expectations, pages) };
}

function staleEntries(expectations, pages) {
  const present = new Map([...pages].map(([suite, paths]) => [suite, new Set(paths)]));
  return [...expectations.values()].filter((e) => present.has(e.suite) && !present.get(e.suite).has(e.path));
}

/**
 * Returns the expectations an `--update` run writes: entries for pages that
 * ran take their new outcome (keeping the reason when the outcome is
 * unchanged, removed when the page passed), SKIP entries stay as they are, and
 * on an unfiltered run stale entries are dropped.
 */
export function updateExpectations(expectations, results, pages, { filtered = false } = {}) {
  const next = new Map(expectations);
  for (const result of results) {
    const key = keyOf(result.suite, result.path);
    const entry = next.get(key);
    if (entry?.outcome === 'SKIP') continue;
    if (result.outcome === 'PASS') next.delete(key);
    else if (entry?.outcome !== result.outcome) {
      next.set(key, { suite: result.suite, path: result.path, outcome: result.outcome, reason: reasonFor(result) });
    }
  }
  if (!filtered) for (const e of staleEntries(next, pages)) next.delete(keyOf(e.suite, e.path));
  return next;
}

/**
 * Concludes a run. With `update`, the run is judged against the expectations
 * it writes (returned as `written`), so only harness errors can fail it.
 */
export function concludeRun(expectations, results, pages, { filtered = false, update = false, harnessErrors = 0 } = {}) {
  const written = update ? updateExpectations(expectations, results, pages, { filtered }) : undefined;
  const verdict = judge(written ?? expectations, results, pages, { filtered });
  const ok = harnessErrors === 0 && verdict.unexpected.length === 0 && verdict.stale.length === 0;
  return { ...verdict, written, ok };
}
