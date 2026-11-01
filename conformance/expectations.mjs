// The checked-in expectations file and how runs are judged against it.
//
// Format, one entry per line: `<suite> <path> <OUTCOME> [<platform> ...] #
// <reason>`, with blank lines and `#` comment lines allowed. The bracketed
// platform list is optional: an entry without one applies on every platform,
// and a page may have several listed entries whose lists do not overlap. A
// page without an entry that applies is expected to PASS.
import { SUITES } from './lists.mjs';

export const OUTCOMES = ['PASS', 'FAIL', 'TIMEOUT', 'CRASH'];
const ENTRY_OUTCOMES = ['FAIL', 'TIMEOUT', 'CRASH', 'SKIP'];
const REASON_LIMIT = 200;
/** Platform names, as in angle/bundles.toml. */
export const PLATFORMS = ['linux-x64', 'linux-arm64', 'macos-arm64', 'windows-x64', 'windows-arm64'];

const HEADER = [
  '# Conformance pages not expected to pass, per suite: <suite> <path> <OUTCOME> [<platform> ...] # <reason>',
  '# An entry without platforms applies everywhere. A page without an entry that applies is expected to',
  '# PASS. See CONTRIBUTING.md; `npm run conformance -- --update` rewrites this file.',
];

/** Map key of a page (an entry without platforms, or a result). */
export const keyOf = (suite, path) => `${suite} ${path}`;

/** Map key of an entry: its page, plus its platforms when it lists any. */
const entryKey = (e) => (e.platforms ? `${keyOf(e.suite, e.path)} [${e.platforms.join(' ')}]` : keyOf(e.suite, e.path));

/** This host's platform name, one of PLATFORMS on a supported host. */
export function hostPlatform() {
  const os = { darwin: 'macos', win32: 'windows' }[process.platform] ?? process.platform;
  return `${os}-${process.arch}`;
}

const appliesOn = (e, platform) => e.platforms === undefined || e.platforms.includes(platform);

/** The entries that apply on `platform`, keyed by `keyOf(suite, path)`. */
export function applicable(expectations, platform = hostPlatform()) {
  return new Map([...expectations.values()].filter((e) => appliesOn(e, platform)).map((e) => [keyOf(e.suite, e.path), e]));
}

/** An entry with `platforms` in PLATFORMS order, written without a list when it names all of them. */
function withPlatforms({ suite, path, outcome, reason }, platforms) {
  const sorted = PLATFORMS.filter((p) => platforms.includes(p));
  return sorted.length === PLATFORMS.length ? { suite, path, outcome, reason } : { suite, path, outcome, platforms: sorted, reason };
}

/**
 * Parses expectations text into a Map from an entry key to
 * `{ suite, path, outcome, platforms?, reason }`; an entry without platforms is
 * keyed by `keyOf(suite, path)`. Throws one error naming every bad line.
 */
export function parseExpectations(text, source = 'expectations.txt') {
  const entries = new Map();
  const byPage = new Map();
  const errors = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const where = `${source}:${index + 1}`;
    const match = /^(\S+)\s+(\S+)\s+(\S+)(?:\s+\[([^\]]*)\])?(?:\s+#(.*))?$/.exec(line);
    if (!match) {
      errors.push(`${where}: expected "<suite> <path> <OUTCOME> [<platform> ...] # <reason>"`);
      return;
    }
    const [, suite, path, outcome, rawPlatforms, rawReason] = match;
    const reason = (rawReason ?? '').trim();
    const platforms = rawPlatforms?.trim().split(/\s+/).filter((p) => p !== '');
    const unknown = platforms?.find((p) => !PLATFORMS.includes(p));
    const siblings = byPage.get(keyOf(suite, path)) ?? [];
    const overlap = platforms && siblings.flatMap((e) => e.platforms ?? []).find((p) => platforms.includes(p));
    if (!Object.hasOwn(SUITES, suite)) errors.push(`${where}: unknown suite ${suite}`);
    else if (!ENTRY_OUTCOMES.includes(outcome)) errors.push(`${where}: unknown outcome ${outcome}`);
    else if (platforms?.length === 0) errors.push(`${where}: ${suite} ${path} has an empty platform list`);
    else if (unknown !== undefined) errors.push(`${where}: unknown platform ${unknown}`);
    else if (platforms && new Set(platforms).size !== platforms.length) errors.push(`${where}: ${suite} ${path} repeats a platform`);
    else if (reason === '') errors.push(`${where}: ${suite} ${path} has no reason`);
    else if (siblings.length > 0 && (!platforms || siblings.some((e) => !e.platforms))) errors.push(`${where}: duplicate entry for ${suite} ${path}`);
    else if (overlap !== undefined) errors.push(`${where}: entries for ${suite} ${path} overlap on ${overlap}`);
    else {
      const entry = withPlatforms({ suite, path, outcome, reason }, platforms ?? PLATFORMS);
      entries.set(entryKey(entry), entry);
      byPage.set(keyOf(suite, path), [...siblings, entry]);
    }
  });
  if (errors.length > 0) throw new Error(`invalid expectations:\n  ${errors.join('\n  ')}`);
  return entries;
}

/** Formats entries as expectations text, sorted by suite, path, then first platform. */
export function formatExpectations(entries) {
  const first = (e) => PLATFORMS.indexOf(e.platforms?.[0] ?? PLATFORMS[0]);
  const sorted = [...entries.values()].sort((a, b) =>
    compare(a.suite, b.suite) || compare(a.path, b.path) || first(a) - first(b),
  );
  const lines = sorted.map((e) => `${e.suite} ${e.path} ${e.outcome}${e.platforms ? ` [${e.platforms.join(' ')}]` : ''} # ${e.reason}`);
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
 * list; `filter` keeps paths containing it. SKIP pages (on `platform`) are run
 * only with `includeSkipped`; otherwise they are returned in `skipped`.
 */
export function selectPages(pages, expectations, { filter, includeSkipped = false, platform = hostPlatform() } = {}) {
  const applying = applicable(expectations, platform);
  const run = [];
  const skipped = [];
  for (const [suite, paths] of pages) {
    for (const path of paths) {
      if (filter !== undefined && !path.includes(filter)) continue;
      const isSkip = applying.get(keyOf(suite, path))?.outcome === 'SKIP';
      if (isSkip && !includeSkipped) skipped.push({ suite, path });
      else run.push({ suite, path });
    }
  }
  return { run, skipped };
}

/**
 * Judges `results` ({ suite, path, outcome, message }) against the
 * `expectations` that apply on `platform`. `pages` maps the suites that ran to
 * their page lists; stale entries (on any platform) are looked for only in
 * those suites, and only when the run was not filtered. Results of SKIP pages
 * are returned in `unjudged`.
 */
export function judge(expectations, results, pages, { filtered = false, platform = hostPlatform() } = {}) {
  const applying = applicable(expectations, platform);
  const unexpected = [];
  const unjudged = [];
  for (const result of results) {
    const entry = applying.get(keyOf(result.suite, result.path));
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
 * Returns the expectations an `--update` run on `platform` writes. For a page
 * that ran, an entry without platforms counts as listing all of them; SKIP
 * entries, entries that do not apply on `platform` and entries whose outcome
 * matches stay as they are (keeping their reason). Otherwise `platform` is
 * removed from the page's entry (and the entry when no platform remains), and
 * a non-PASS outcome is added to the page's entry with that outcome, to a new
 * entry for `platform` when the page has other entries, or to a new entry
 * without platforms. On an unfiltered run stale entries are dropped.
 */
export function updateExpectations(expectations, results, pages, { filtered = false, platform = hostPlatform() } = {}) {
  const next = new Map(expectations);
  for (const result of results) {
    const siblings = [...next.values()].filter((e) => e.suite === result.suite && e.path === result.path);
    const entry = siblings.find((e) => appliesOn(e, platform));
    if (entry?.outcome === 'SKIP' || entry?.outcome === result.outcome) continue;
    let others = siblings;
    if (entry !== undefined) {
      next.delete(entryKey(entry));
      others = siblings.filter((e) => e !== entry);
      const rest = (entry.platforms ?? PLATFORMS).filter((p) => p !== platform);
      if (rest.length > 0) {
        const narrowed = withPlatforms(entry, rest);
        next.set(entryKey(narrowed), narrowed);
        others = [...others, narrowed];
      }
    }
    if (result.outcome === 'PASS') continue;
    const same = others.find((e) => e.outcome === result.outcome);
    const fresh = { suite: result.suite, path: result.path, outcome: result.outcome, reason: reasonFor(result) };
    if (same !== undefined) {
      next.delete(entryKey(same));
      const widened = withPlatforms(same, [...same.platforms, platform]);
      next.set(entryKey(widened), widened);
    } else if (others.length > 0) {
      const listed = withPlatforms(fresh, [platform]);
      next.set(entryKey(listed), listed);
    } else next.set(entryKey(fresh), fresh);
  }
  if (!filtered) for (const e of staleEntries(next, pages)) next.delete(entryKey(e));
  return next;
}

/**
 * Concludes a run. With `update`, the run is judged against the expectations
 * it writes (returned as `written`), so only harness errors can fail it.
 */
export function concludeRun(
  expectations,
  results,
  pages,
  { filtered = false, update = false, harnessErrors = 0, platform = hostPlatform() } = {},
) {
  const written = update ? updateExpectations(expectations, results, pages, { filtered, platform }) : undefined;
  const verdict = judge(written ?? expectations, results, pages, { filtered, platform });
  const ok = harnessErrors === 0 && verdict.unexpected.length === 0 && verdict.stale.length === 0;
  return { ...verdict, written, ok };
}
