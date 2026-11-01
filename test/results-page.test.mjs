import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildPage, cellOf, main, readReports } from '../scripts/results-page.mjs';

const PLATFORMS = ['linux-x64', 'linux-arm64', 'macos-arm64', 'windows-x64', 'windows-arm64'];

/** A conformance report for one suite on one platform. */
function conformance(platform, suite, pages, timestamp = '2026-11-01T10:00:00.000Z') {
  return { report: { commit: 'abcdef0123456', platform, timestamp, suites: { [suite]: { pages } } }, file: `${platform}-${suite}.json` };
}
/** A three.js report on one platform. */
function threejs(platform, examples) {
  return { report: { tag: 'r182', commit: 'f00', platform, timestamp: '2026-11-01T09:00:00.000Z', examples }, file: `${platform}-threejs.json` };
}
const pass = (path) => ({ path, expected: 'PASS', reason: null, outcome: 'PASS', message: null, error: null });

/** Every conformance report for a suite where all platforms pass `paths`. */
const allPlatforms = (suite, paths) => PLATFORMS.map((p) => conformance(p, suite, paths.map(pass)));

/** The `<section>` whose heading is `title`. */
function section(html, title) {
  const start = html.indexOf(`<h2>${title}</h2>`);
  assert.notEqual(start, -1, title);
  return html.slice(html.lastIndexOf('<section', start), html.indexOf('</section>', start));
}
/** The `<tr>` for `name` in `html`. */
function row(html, name) {
  const at = html.indexOf(`<td class="name">${name}</td>`);
  assert.notEqual(at, -1, name);
  return html.slice(html.lastIndexOf('<tr', at), html.indexOf('</tr>', at));
}
const cells = (tr) => [...tr.matchAll(/<td class="cell ([^"]*)"(?: title="([^"]*)")?><span>([^<]*)<\/span>/g)].map((m) => ({ cls: m[1], title: m[2], label: m[3] }));

test('cell labels and hover text', () => {
  assert.deepEqual(cellOf(undefined), { outcome: 'NOTRUN', label: 'not run', unexpected: false, hover: 'not run' });
  assert.deepEqual(cellOf(pass('a')), { outcome: 'PASS', label: 'PASS', unexpected: false, hover: '' });
  assert.equal(cellOf({ expected: 'FAIL', reason: 'ANGLE: known', outcome: 'FAIL', message: 'boom' }).hover, 'ANGLE: known');
  assert.equal(cellOf({ expected: 'SKIP', reason: 'upstream: video hangs CI', outcome: 'SKIP' }).hover, 'upstream: video hangs CI');
  // A report from before the runners recorded reasons falls back to the message, then the error.
  assert.equal(cellOf({ expected: 'FAIL', outcome: 'FAIL', message: 'expected 1, got 0', error: 'stack' }).hover, 'expected 1, got 0');
  assert.equal(cellOf({ expected: 'TIMEOUT', outcome: 'TIMEOUT', message: null, error: 'no result for 60 s' }).hover, 'no result for 60 s');
  const timeout = cellOf({ expected: 'TIMEOUT', reason: 'slow runner', outcome: 'TIMEOUT' });
  assert.deepEqual([timeout.label, timeout.unexpected], ['TIMEOUT', false]);
  const crash = cellOf({ expected: 'PASS', reason: null, outcome: 'CRASH', message: null, error: 'exit code 3' });
  assert.deepEqual([crash.label, crash.unexpected, crash.hover], ['CRASH', true, 'Unexpected (expected PASS): exit code 3']);
  assert.equal(cellOf({ expected: 'PASS', outcome: 'FAIL', message: 'expected 1, got 0', error: 'stack' }).hover, 'Unexpected (expected PASS): expected 1, got 0');
  assert.equal(cellOf({ expected: 'PASS', outcome: 'HARNESS_ERROR', message: 'runner broke' }).label, 'ERROR');
  // An unexpected pass is marked and says what was expected.
  assert.deepEqual(cellOf({ expected: 'FAIL', reason: 'known', outcome: 'PASS', message: null }), { outcome: 'PASS', label: 'PASS', unexpected: true, hover: 'Unexpected (expected FAIL)' });
  // A pass within a DIFF tolerance was expected.
  assert.equal(cellOf({ expected: 'DIFF 1%', reason: 'rasterization', outcome: 'PASS' }).unexpected, false);
  assert.equal(cellOf({ expected: 'DIFF 1%', reason: 'rasterization', outcome: 'FAIL', message: '3% differ' }).unexpected, true);
  assert.equal(cellOf({ expected: 'PASS', outcome: 'FAIL', message: 'x'.repeat(5000) }).hover.length, 1000);
});

test('the page: rows, columns, marks, counts and missing reports', () => {
  const html = buildPage(
    [
      ...PLATFORMS.map((p) =>
        conformance(p, 'webgl1', [
          pass('a.html'),
          { path: 'known.html', expected: 'FAIL', reason: 'ANGLE: known', outcome: 'FAIL', message: 'm', error: null },
          p === 'windows-x64' ? { path: 'regressed.html', expected: 'PASS', reason: null, outcome: 'FAIL', message: 'expected 1, got 0', error: null } : pass('regressed.html'),
          ...(p === 'linux-arm64' ? [pass('arm-only.html')] : []),
        ], p === 'macos-arm64' ? '2026-11-01T12:34:56.000Z' : undefined),
      ),
      // webgl2: no macOS report.
      ...allPlatforms('webgl2', ['b.html']).filter(({ report }) => report.platform !== 'macos-arm64'),
      threejs('linux-arm64', [
        { name: 'cube', expected: 'PASS', reason: null, outcome: 'PASS' },
        { name: 'video', expected: 'SKIP', reason: 'upstream: video hangs CI', outcome: 'SKIP' },
      ]),
    ],
    { commit: '0123456789abcdef' },
  );

  const webgl1 = section(html, 'WebGL 1 conformance');
  assert.match(webgl1, /4 tests, 2 with a result that isn't PASS, <span class="unexpected-count">1 unexpected<\/span>/);
  assert.doesNotMatch(webgl1, /No report from/);
  assert.match(row(webgl1, 'a.html'), /^<tr class="passing">/);
  assert.deepEqual(cells(row(webgl1, 'known.html')).map((c) => [c.label, c.title]), PLATFORMS.map(() => ['FAIL', 'ANGLE: known']));
  const regressed = cells(row(webgl1, 'regressed.html'));
  assert.deepEqual(regressed[3], { cls: 'FAIL unexpected', title: 'Unexpected (expected PASS): expected 1, got 0', label: 'FAIL' });
  assert.match(row(webgl1, 'regressed.html'), /^<tr>/);
  // The union of rows: a test one platform reported is "not run" elsewhere, and only "not run" doesn't make a row non-PASS.
  const armOnly = cells(row(webgl1, 'arm-only.html'));
  assert.deepEqual(armOnly.map((c) => c.label), ['not run', 'PASS', 'not run', 'not run', 'not run']);
  assert.equal(armOnly[0].title, 'not run');
  assert.match(row(webgl1, 'arm-only.html'), /^<tr class="passing">/);

  const webgl2 = section(html, 'WebGL 2 conformance');
  assert.match(webgl2, /^<section class="all-passing">/);
  assert.match(webgl2, /No report from macos-arm64: those columns read "not run"/);

  const three = section(html, 'three.js examples');
  assert.match(three, /No report from linux-x64, macos-arm64, windows-x64, windows-arm64/);
  assert.deepEqual(cells(row(three, 'video'))[1], { cls: 'SKIP', title: 'upstream: video hangs CI', label: 'SKIP' });

  assert.match(html, /Results from oxgl commit <a href="https:\/\/github.com\/jerryryle\/oxgl\/commit\/0123456789abcdef"><code>0123456<\/code><\/a> · 2026-11-01 12:34 UTC · conformance suite <code>abcdef0<\/code> · three\.js <code>r182<\/code>\./);
  assert.doesNotMatch(html, /<!-- results:/);
});

test('a suite with no report at all says so, without a table', () => {
  const html = buildPage(allPlatforms('webgl1', ['a.html']), { commit: 'abc' });
  const three = section(html, 'three.js examples');
  assert.match(three, /No platform reported results for this suite in this run/);
  assert.doesNotMatch(three, /<table|all-passing/);
});

test('report text is escaped', () => {
  const html = buildPage(
    [conformance('linux-x64', 'webgl1', [{ path: '<i>x</i>.html', expected: 'PASS', reason: null, outcome: 'FAIL', message: '</script><b>x</b>"\'&', error: null }])],
    { commit: 'abc' },
  );
  assert.ok(html.includes('title="Unexpected (expected PASS): &lt;/script&gt;&lt;b&gt;x&lt;/b&gt;&quot;&#39;&amp;"'));
  assert.ok(html.includes('<td class="name">&lt;i&gt;x&lt;/i&gt;.html</td>'));
  assert.ok(!html.includes('<b>x</b>'));
});

test('unknown platforms and duplicate reports are refused, naming the files', () => {
  assert.throws(() => buildPage([conformance('freebsd-x64', 'webgl1', [])], { commit: 'abc' }), /freebsd-x64-webgl1\.json is from platform freebsd-x64/);
  assert.throws(
    () => buildPage([conformance('linux-x64', 'webgl1', []), { ...conformance('linux-x64', 'webgl1', []), file: 'again.json' }], { commit: 'abc' }),
    /linux-x64-webgl1\.json and again\.json both report webgl1 on linux-x64/,
  );
});

test('the command reads reports from artifact directories and writes the page', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oxgl-results-page-'));
  try {
    for (const { report, file } of [...allPlatforms('webgl1', ['a.html']), threejs('linux-arm64', [])]) {
      const artifact = join(dir, 'artifacts', file.replace('.json', ''));
      mkdirSync(artifact, { recursive: true });
      writeFileSync(join(artifact, report.examples ? 'threejs-results.json' : 'conformance-results.json'), JSON.stringify(report));
    }
    writeFileSync(join(dir, 'artifacts', 'unrelated.json'), '{}');
    assert.equal(readReports(join(dir, 'artifacts')).length, 6);
    const out = join(dir, 'site', 'index.html');
    main(['--commit', 'abc1234', join(dir, 'artifacts'), out]);
    assert.match(readFileSync(out, 'utf8'), /<h2>WebGL 1 conformance<\/h2>/);
    assert.throws(() => main([join(dir, 'artifacts'), out]), /usage: .*--commit/);
    writeFileSync(join(dir, 'artifacts', 'linux-x64-webgl1', 'conformance-results.json'), '{"platform": "linux-x64", "suit');
    assert.throws(() => readReports(join(dir, 'artifacts')), /linux-x64-webgl1[/\\]conformance-results\.json is not a readable report/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
