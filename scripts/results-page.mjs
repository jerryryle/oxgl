// Builds the results page (openspec results-page): one table of the Khronos
// conformance suites' and the three.js examples' outcomes on every platform.
// It reads every conformance-results.json and threejs-results.json under
// <dir> (as actions/download-artifact lays them out) and fills the markers in
// scripts/results-page.html with escaped static HTML.
//
//     node scripts/results-page.mjs --commit <sha> [--page-commit <sha>] <dir> <out.html>
//
// --commit is the oxgl commit whose CI run produced the reports; --page-commit,
// when it differs, the commit the page itself was built at (a page-only change
// republishing earlier results).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { PLATFORMS } from '../conformance/expectations.mjs';

export const TEMPLATE_PATH = fileURLToPath(new URL('results-page.html', import.meta.url));
const REPO = 'https://github.com/jerryryle/oxgl';
/** Hover text is cut to this many characters. */
const MAX_HOVER = 1000;

const SECTIONS = [
  { suite: 'webgl1', title: 'WebGL 1 conformance', about: 'The Khronos WebGL 1.0 conformance suite, run on every platform.' },
  {
    suite: 'webgl2',
    title: 'WebGL 2 conformance',
    about: 'The Khronos WebGL 2.0 conformance suite, including the dEQP pages, run on every platform.',
  },
  {
    suite: 'threejs',
    title: 'three.js examples',
    about: "three.js's own examples, each frame compared with the release's reference screenshot. These run on Linux arm64 only.",
  },
];

/** Escapes text for HTML element content and quoted attribute values. */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Every report file under `dir`, read and tagged with its path. */
export function readReports(dir) {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((path) => ['conformance-results.json', 'threejs-results.json'].includes(basename(path)))
    .sort()
    .map((path) => {
      const file = join(dir, path);
      try {
        return { file, report: JSON.parse(readFileSync(file, 'utf8')) };
      } catch (error) {
        throw new Error(`results-page: ${file} is not a readable report: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    });
}

/**
 * The runs the reports describe: per suite, per platform, a map from test
 * name to its report entry. Refuses unknown platforms and duplicate reports.
 */
export function collect(reports) {
  const runs = new Map(SECTIONS.map(({ suite }) => [suite, new Map()]));
  const seen = new Map();
  const suiteCommits = new Set();
  let threejsTag;
  let newest;
  for (const { file, report } of reports) {
    if (!PLATFORMS.includes(report.platform)) {
      throw new Error(`results-page: ${file} is from platform ${String(report.platform)}, not one of ${PLATFORMS.join(', ')}`);
    }
    const suites = report.examples
      ? { threejs: report.examples.map((e) => ({ ...e, path: e.name })) }
      : Object.fromEntries(Object.entries(report.suites).map(([suite, { pages }]) => [suite, pages]));
    if (report.examples) threejsTag = report.tag;
    else suiteCommits.add(report.commit);
    if (newest === undefined || report.timestamp > newest) newest = report.timestamp;
    for (const [suite, entries] of Object.entries(suites)) {
      const key = `${suite} ${report.platform}`;
      if (seen.has(key)) throw new Error(`results-page: ${seen.get(key)} and ${file} both report ${suite} on ${report.platform}`);
      seen.set(key, file);
      runs.get(suite)?.set(report.platform, new Map(entries.map((e) => [e.path, e])));
    }
  }
  return { runs, suiteCommits: [...suiteCommits], threejsTag, newest };
}

/** An expected outcome as the runners judge it: `DIFF <p>%` passes. */
const normalize = (expected) => (String(expected).startsWith('DIFF') ? 'PASS' : expected);

/** A cell's label, class, hover text and whether it was unexpected. */
export function cellOf(entry) {
  if (entry === undefined) return { outcome: 'NOTRUN', label: 'not run', unexpected: false, hover: 'not run' };
  const expected = normalize(entry.expected ?? 'PASS');
  const outcome = entry.outcome === 'HARNESS_ERROR' ? 'ERROR' : entry.outcome;
  // The runners never count an expected SKIP as unexpected.
  const unexpected = expected !== 'SKIP' && entry.outcome !== expected;
  let why = '';
  if (unexpected) why = entry.message ?? entry.error ?? '';
  // Reports from before the runners recorded `reason` fall back to the message.
  else if (entry.outcome !== 'PASS') why = entry.reason ?? entry.message ?? entry.error ?? '';
  const hover = unexpected ? `Unexpected (expected ${expected})${why ? `: ${why}` : ''}` : why;
  return { outcome, label: outcome, unexpected, hover: hover.length > MAX_HOVER ? `${hover.slice(0, MAX_HOVER - 1)}…` : hover };
}

/** Whether a row shows in the default view: a result other than PASS, or an unexpected one. */
const notPassing = (cells) => cells.some((c) => (c.outcome !== 'PASS' && c.outcome !== 'NOTRUN') || c.unexpected);

function renderSection({ suite, title, about }, runs) {
  const byPlatform = runs.get(suite);
  const missing = PLATFORMS.filter((p) => !byPlatform.has(p));
  const head = `<section>\n<h2>${escapeHtml(title)}</h2>`;
  if (missing.length === PLATFORMS.length) {
    return `${head}\n<p class="about">${escapeHtml(about)}</p>\n<p class="missing">No platform reported results for this suite in this run.</p>\n</section>`;
  }
  const names = [...new Set([...byPlatform.values()].flatMap((entries) => [...entries.keys()]))].sort((a, b) => a.localeCompare(b));
  let failing = 0;
  let unexpected = 0;
  const rows = names.map((name) => {
    const cells = PLATFORMS.map((p) => cellOf(byPlatform.get(p)?.get(name)));
    const shown = notPassing(cells);
    if (shown) failing += 1;
    unexpected += cells.filter((c) => c.unexpected).length;
    const tds = cells.map((c) => {
      const title = c.hover === '' ? '' : ` title="${escapeHtml(c.hover)}"`;
      return `<td class="cell ${c.outcome}${c.unexpected ? ' unexpected' : ''}"${title}><span>${escapeHtml(c.label)}</span></td>`;
    });
    return `<tr${shown ? '' : ' class="passing"'}><td class="name">${escapeHtml(name)}</td>${tds.join('')}</tr>`;
  });
  const counts = `${names.length} tests, ${failing} with a result that isn't PASS, `
    + `<span class="${unexpected ? 'unexpected-count' : ''}">${unexpected} unexpected</span>.`;
  const missingNote = missing.length === 0 ? '' : `\n<p class="missing">No report from ${missing.map(escapeHtml).join(', ')}: those columns read "not run".</p>`;
  return `<section${failing === 0 ? ' class="all-passing"' : ''}>
<h2>${escapeHtml(title)}</h2>
<p class="about">${escapeHtml(about)} ${counts}</p>${missingNote}
<p class="none">Every test that ran passed.</p>
<p class="no-match-note">No rows in this view match the search.</p>
<div class="table-wrap"><table>
<thead><tr><th>Test</th>${PLATFORMS.map((p) => `<th class="platform">${escapeHtml(p)}</th>`).join('')}</tr></thead>
<tbody>
${rows.join('\n')}
</tbody></table></div>
</section>`;
}

/** `2026-11-01T21:14:09.123Z` as `2026-11-01 21:14 UTC`. */
const formatTime = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

/** A linked, shortened oxgl commit. */
const commitLink = (sha) => `<a href="${REPO}/commit/${escapeHtml(sha)}"><code>${escapeHtml(sha.slice(0, 7))}</code></a>`;

function renderMeta({ commit, pageCommit, newest, suiteCommits, threejsTag }) {
  const parts = [`Results from oxgl commit ${commitLink(commit)}`];
  if (newest) parts.push(escapeHtml(formatTime(newest)));
  if (suiteCommits.length > 0) parts.push(`conformance suite ${suiteCommits.map((c) => `<code>${escapeHtml(String(c).slice(0, 7))}</code>`).join(', ')}`);
  if (threejsTag) parts.push(`three.js <code>${escapeHtml(threejsTag)}</code>`);
  if (pageCommit && pageCommit !== commit) parts.push(`page built at ${commitLink(pageCommit)}`);
  return `<p class="meta">${parts.join(' · ')}.</p>`;
}

/**
 * The filled page for `reports` (from readReports), the oxgl `commit` they
 * come from and, when it differs, the `pageCommit` the page was built at.
 */
export function buildPage(reports, { commit, pageCommit, template = readFileSync(TEMPLATE_PATH, 'utf8') }) {
  const { runs, ...meta } = collect(reports);
  const markers = { '<!-- results:meta -->': renderMeta({ commit, pageCommit, ...meta }), '<!-- results:sections -->': SECTIONS.map((s) => renderSection(s, runs)).join('\n') };
  let html = template;
  for (const [marker, content] of Object.entries(markers)) {
    if (!html.includes(marker)) throw new Error(`results-page: the template has no ${marker} marker`);
    html = html.replace(marker, () => content);
  }
  return html;
}

export function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args: argv, options: { commit: { type: 'string' }, 'page-commit': { type: 'string' } }, allowPositionals: true });
  const [dir, out] = positionals;
  if (!values.commit || !dir || !out || positionals.length !== 2) {
    throw new Error('usage: node scripts/results-page.mjs --commit <sha> [--page-commit <sha>] <dir> <out.html>');
  }
  const reports = readReports(dir);
  const html = buildPage(reports, { commit: values.commit, pageCommit: values['page-commit'] });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`results-page: ${out} from ${String(reports.length)} reports (${String(html.length)} bytes)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
