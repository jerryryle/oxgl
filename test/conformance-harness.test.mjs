// conformance-testing spec scenarios for the harness's own logic: test lists,
// expectations, judging, the suite server and the page runner.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  concludeRun,
  formatExpectations,
  hostPlatform,
  normalizeReason,
  parseExpectations,
  PLATFORMS,
  selectPages,
} from '../conformance/expectations.mjs';
import { listPages, versionAtLeast } from '../conformance/lists.mjs';
import { pageURL, runPages } from '../conformance/pool.mjs';
import { main, runConformance } from '../conformance/run.mjs';
import { startServer } from '../conformance/server.mjs';
import { ensureCheckout, ensureSuite } from '../conformance/suite.mjs';

import { entryOf } from './helpers.mjs';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'conformance');

// --- Test lists -------------------------------------------------------------

/** A fixture suite: list paths (relative to the suite root) → contents. */
const LISTS = {
  '00_test_list.txt': [
    '// files that end in .txt list other tests',
    '',
    'conformance/00_test_list.txt',
    '--min-version 2.0.0 conformance2/00_test_list.txt',
  ].join('\n'),
  'conformance/00_test_list.txt': [
    '# comment',
    '; also a comment',
    'basic.html',
    '--slow slow-page.html',
    '--min-version 1.0.4 newer.html',
    '--max-version 1.9.9 webgl1-only.html',
    '--min-version 1.0.3 nested/00_test_list.txt',
  ].join('\n'),
  'conformance/nested/00_test_list.txt': ['inherits.html', '--min-version 1.0.2 overrides.html'].join('\n'),
  'conformance2/00_test_list.txt': ['webgl2-page.html'].join('\n'),
};

const readFixture = (path) => {
  const relative = path.replaceAll('\\', '/').replace(/^root\//, '');
  if (!(relative in LISTS)) throw new Error(`no fixture list ${relative}`);
  return LISTS[relative];
};

test('version comparison follows the official harness', () => {
  assert.ok(versionAtLeast('2.0.1 (beta)', '2.0.0'));
  assert.ok(versionAtLeast('1.0.4', '1.0'));
  assert.ok(versionAtLeast('1.1', '1.0.9'));
  assert.ok(!versionAtLeast('1.0.4', '1.1'));
  assert.ok(!versionAtLeast('2.0.1', '2.1'));
});

test('webgl1 list: nesting, comments, version filters, no conformance2', () => {
  assert.deepEqual(listPages('root', '1.0.4', readFixture), [
    'conformance/basic.html',
    'conformance/slow-page.html',
    'conformance/newer.html',
    'conformance/webgl1-only.html',
    'conformance/nested/inherits.html',
    'conformance/nested/overrides.html',
  ]);
  assert.deepEqual(listPages('root', '1.0.3', readFixture), [
    'conformance/basic.html',
    'conformance/slow-page.html',
    'conformance/webgl1-only.html',
    'conformance/nested/inherits.html',
    'conformance/nested/overrides.html',
  ]);
});

test('webgl2 list: conformance/ included, max-version honoured, conformance2 added', () => {
  assert.deepEqual(listPages('root', '2.0.1', readFixture), [
    'conformance/basic.html',
    'conformance/slow-page.html',
    'conformance/newer.html',
    'conformance/nested/inherits.html',
    'conformance/nested/overrides.html',
    'conformance2/webgl2-page.html',
  ]);
});

test('unknown test-list option is an error naming the line', () => {
  const read = () => 'ok.html\n--bogus page.html\n';
  assert.throws(() => listPages('root', '1.0.4', read), /00_test_list\.txt:2: unknown option --bogus/);
});

// --- Expectations -----------------------------------------------------------

const SAMPLE = [
  '# header comment',
  '',
  'webgl2 conformance/b.html TIMEOUT # timed out',
  'webgl1 conformance/b.html FAIL # gl.foo is not a function',
  'webgl1 conformance/a.html SKIP # hangs: waits on video',
].join('\n');

test('expectations parse and format round-trip stably, sorted by suite then path', () => {
  const entries = parseExpectations(SAMPLE);
  assert.equal(entries.size, 3);
  assert.deepEqual(entries.get('webgl1 conformance/b.html'), {
    suite: 'webgl1',
    path: 'conformance/b.html',
    outcome: 'FAIL',
    reason: 'gl.foo is not a function',
  });
  const text = formatExpectations(entries);
  const lines = text.split('\n').filter((l) => l !== '' && !l.startsWith('#'));
  assert.deepEqual(lines, [
    'webgl1 conformance/a.html SKIP # hangs: waits on video',
    'webgl1 conformance/b.html FAIL # gl.foo is not a function',
    'webgl2 conformance/b.html TIMEOUT # timed out',
  ]);
  assert.equal(formatExpectations(parseExpectations(text)), text);
});

test('Entry without a reason: parsing fails naming the entry', () => {
  assert.throws(() => parseExpectations('webgl1 conformance/a.html FAIL'), /:1: webgl1 conformance\/a\.html has no reason/);
  assert.throws(() => parseExpectations('webgl1 conformance/a.html FAIL #   '), /has no reason/);
});

test('unknown outcomes, unknown suites, malformed lines and duplicates are rejected', () => {
  assert.throws(() => parseExpectations('webgl1 a.html PASS # listed'), /unknown outcome PASS/);
  assert.throws(() => parseExpectations('webgl3 a.html FAIL # x'), /unknown suite webgl3/);
  assert.throws(() => parseExpectations('webgl1 a.html'), /expected "<suite> <path> <OUTCOME> \[<platform> \.\.\.\] # <reason>"/);
  assert.throws(
    () => parseExpectations('webgl1 a.html FAIL # x\nwebgl1 a.html TIMEOUT # y'),
    /:2: duplicate entry for webgl1 a\.html/,
  );
});

test('a multi-line failure message becomes a single-line reason of at most 200 characters', () => {
  assert.equal(normalizeReason('\n\n  ERROR: 0:3:   syntax   error\nsecond line\n'), 'ERROR: 0:3: syntax error');
  const long = normalizeReason(`TypeError: ${'x'.repeat(500)}\n    at page.html:10`);
  assert.equal(long.length, 200);
  assert.ok(!long.includes('\n'));
});

// --- Judging ----------------------------------------------------------------

const pages = (entries) => new Map(Object.entries(entries));
/** The entry lines of an expectations Map, as the file would list them. */
const entryLines = (entries) => formatExpectations(entries).split('\n').filter((l) => l !== '' && !l.startsWith('#'));
const result = (suite, path, outcome, message) => ({ suite, path, outcome, message });

test('Regression: an expected PASS that fails is named with both outcomes', () => {
  const run = concludeRun(new Map(), [result('webgl1', 'p.html', 'FAIL', 'boom')], pages({ webgl1: ['p.html'] }));
  assert.equal(run.ok, false);
  assert.deepEqual(
    run.unexpected.map((u) => [u.path, u.expected, u.outcome]),
    [['p.html', 'PASS', 'FAIL']],
  );
});

test('Unexpected pass: a FAIL entry that passes fails the run', () => {
  const exp = parseExpectations('webgl1 p.html FAIL # was failing');
  const run = concludeRun(exp, [result('webgl1', 'p.html', 'PASS')], pages({ webgl1: ['p.html'] }));
  assert.equal(run.ok, false);
  assert.deepEqual(run.unexpected.map((u) => [u.expected, u.outcome]), [['FAIL', 'PASS']]);
});

test('a different non-PASS outcome than expected fails the run', () => {
  const exp = parseExpectations('webgl1 p.html FAIL # was failing');
  const run = concludeRun(exp, [result('webgl1', 'p.html', 'TIMEOUT')], pages({ webgl1: ['p.html'] }));
  assert.equal(run.ok, false);
  assert.deepEqual(run.unexpected.map((u) => [u.expected, u.outcome]), [['FAIL', 'TIMEOUT']]);
});

test('matching outcomes succeed', () => {
  const exp = parseExpectations('webgl1 f.html FAIL # x');
  const run = concludeRun(exp, [result('webgl1', 'f.html', 'FAIL', 'y'), result('webgl1', 'p.html', 'PASS')], pages({
    webgl1: ['f.html', 'p.html'],
  }));
  assert.equal(run.ok, true);
});

test('Stale entry: an entry naming a page the suite lacks fails an unfiltered run', () => {
  const exp = parseExpectations('webgl1 gone.html FAIL # removed upstream');
  const run = concludeRun(exp, [result('webgl1', 'p.html', 'PASS')], pages({ webgl1: ['p.html'] }));
  assert.equal(run.ok, false);
  assert.deepEqual(run.stale.map((e) => e.path), ['gone.html']);
});

test('Filtered run: other pages are neither checked nor reported stale', () => {
  const exp = parseExpectations('webgl1 gone.html FAIL # removed\nwebgl1 conformance/other/x.html FAIL # x');
  const all = pages({ webgl1: ['conformance/buffers/a.html', 'conformance/other/x.html'] });
  const { run } = selectPages(all, exp, { filter: 'conformance/buffers/' });
  assert.deepEqual(run, [{ suite: 'webgl1', path: 'conformance/buffers/a.html' }]);
  const verdict = concludeRun(exp, [result('webgl1', 'conformance/buffers/a.html', 'PASS')], all, { filtered: true });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.stale, []);
});

test('Single-suite run: webgl2 entries are neither judged nor reported stale', () => {
  const exp = parseExpectations('webgl2 gone.html FAIL # x\nwebgl2 p.html FAIL # x');
  const run = concludeRun(exp, [result('webgl1', 'p.html', 'PASS')], pages({ webgl1: ['p.html'] }));
  assert.equal(run.ok, true);
});

test('Skipped page: not run unless included, and reported as skipped', () => {
  const exp = parseExpectations('webgl1 hang.html SKIP # waits on video');
  const all = pages({ webgl1: ['hang.html', 'p.html'] });
  const selection = selectPages(all, exp);
  assert.deepEqual(selection.run, [{ suite: 'webgl1', path: 'p.html' }]);
  assert.deepEqual(selection.skipped, [{ suite: 'webgl1', path: 'hang.html' }]);
});

test('Skipped pages included: their outcome is reported but not judged', () => {
  const exp = parseExpectations('webgl1 hang.html SKIP # waits on video');
  const all = pages({ webgl1: ['hang.html'] });
  assert.deepEqual(selectPages(all, exp, { includeSkipped: true }).run, [{ suite: 'webgl1', path: 'hang.html' }]);
  for (const outcome of ['TIMEOUT', 'PASS']) {
    const run = concludeRun(exp, [result('webgl1', 'hang.html', outcome)], all);
    assert.equal(run.ok, true);
    assert.deepEqual(run.unjudged.map((r) => r.outcome), [outcome]);
  }
});

test('harness errors fail the run', () => {
  const run = concludeRun(new Map(), [], pages({ webgl1: [] }), { harnessErrors: 1 });
  assert.equal(run.ok, false);
});

// --- --update ---------------------------------------------------------------

test('Updating expectations: reasons kept, passes narrow entries, new reasons normalized, SKIP untouched', () => {
  const exp = parseExpectations(
    [
      'webgl1 same.html FAIL # hand-written reason',
      'webgl1 changed.html FAIL # old reason',
      'webgl1 fixed.html FAIL # old reason',
      'webgl1 skip.html SKIP # waits on video',
    ].join('\n'),
  );
  const all = pages({
    webgl1: ['same.html', 'changed.html', 'fixed.html', 'skip.html', 'new.html', 'hang.html', 'abort.html', 'threw.html', 'incidental.html'],
  });
  const results = [
    result('webgl1', 'same.html', 'FAIL', 'a new message'),
    result('webgl1', 'changed.html', 'TIMEOUT'),
    result('webgl1', 'fixed.html', 'PASS'),
    result('webgl1', 'skip.html', 'PASS'),
    result('webgl1', 'new.html', 'FAIL', '\nTypeError: gl.bufferData is not a function\n    at x.html:3'),
    result('webgl1', 'abort.html', 'CRASH'),
    { ...result('webgl1', 'hang.html', 'TIMEOUT'), error: 'TypeError: gl.foo is not a function\n    at x.html:3' },
    { ...result('webgl1', 'threw.html', 'FAIL', 'successfullyParsed should be true'), error: 'TypeError: gl.bar is not a function', errorBeforeFailure: true, failed: 1 },
    { ...result('webgl1', 'incidental.html', 'FAIL', 'getError was INVALID_ENUM'), error: 'Error: in a timer', errorBeforeFailure: false, failed: 1 },
  ];
  const run = concludeRun(exp, results, all, { update: true, platform: 'linux-arm64' });
  assert.equal(run.ok, true, 'an --update run with differences succeeds');
  // An entry without platforms counts as listing all seven, so the other platforms keep theirs.
  const others = '[linux-x64 macos-arm64 windows-x64 windows-arm64 linux-x64-gles linux-arm64-gles]';
  assert.deepEqual(entryLines(run.written), [
    'webgl1 abort.html CRASH # crashed',
    `webgl1 changed.html FAIL ${others} # old reason`,
    'webgl1 changed.html TIMEOUT [linux-arm64] # no new result within the time limit',
    `webgl1 fixed.html FAIL ${others} # old reason`,
    'webgl1 hang.html TIMEOUT # no new result within the time limit: TypeError: gl.foo is not a function',
    'webgl1 incidental.html FAIL # getError was INVALID_ENUM',
    'webgl1 new.html FAIL # TypeError: gl.bufferData is not a function',
    'webgl1 same.html FAIL # hand-written reason',
    'webgl1 skip.html SKIP # waits on video',
    'webgl1 threw.html FAIL # TypeError: gl.bar is not a function',
  ]);
});

// --- Platform-limited entries ----------------------------------------------

const X64 = 'webgl2 p.html FAIL [linux-x64 windows-x64] # x64 only';

test('platform lists parse, format in platform order, and round-trip', () => {
  const entries = parseExpectations(`webgl2 p.html FAIL [windows-x64 linux-x64] # x64 only\nwebgl2 p.html TIMEOUT [macos-arm64] # slow`);
  assert.deepEqual(entryLines(entries), [X64, 'webgl2 p.html TIMEOUT [macos-arm64] # slow']);
  assert.equal(formatExpectations(parseExpectations(formatExpectations(entries))), formatExpectations(entries));
  const all = parseExpectations('webgl2 p.html FAIL [linux-x64 linux-arm64 macos-arm64 windows-x64 windows-arm64 linux-x64-gles linux-arm64-gles] # x');
  assert.deepEqual(entryLines(all), ['webgl2 p.html FAIL # x'], 'a list of all seven is written without one');
});

test('The OpenGL ES backend is its own platform on each Linux architecture', () => {
  assert.equal(hostPlatform({ platform: 'linux', arch: 'x64', backend: 'gles' }), 'linux-x64-gles');
  assert.equal(hostPlatform({ platform: 'linux', arch: 'x64', backend: 'software' }), 'linux-x64');
  assert.equal(hostPlatform({ platform: 'linux', arch: 'x64', backend: '' }), 'linux-x64', 'OXGL_BACKEND empty');
  assert.equal(hostPlatform({ platform: 'linux', arch: 'arm64', backend: 'gles' }), 'linux-arm64-gles');
  assert.equal(hostPlatform({ platform: 'linux', arch: 'arm64', backend: 'gpu' }), 'linux-arm64');
  assert.equal(hostPlatform({ platform: 'darwin', arch: 'arm64', backend: 'gles' }), 'macos-arm64');
});

test('OpenGL ES backend judged on its own platform', () => {
  const all = pages({ webgl2: ['p.html'] });
  const exp = parseExpectations('webgl2 p.html FAIL [linux-x64] # software only');
  const run = concludeRun(exp, [result('webgl2', 'p.html', 'PASS')], all, { platform: 'linux-x64-gles', update: true });
  assert.equal(run.ok, true, 'the linux-x64 entry does not apply');
  assert.deepEqual(entryLines(run.written), ['webgl2 p.html FAIL [linux-x64] # software only']);
});

test('Update on the OpenGL ES backend keeps the entry for the six other platforms', () => {
  const all = pages({ webgl2: ['p.html'] });
  const exp = parseExpectations('webgl2 p.html FAIL # everywhere');
  const run = concludeRun(exp, [result('webgl2', 'p.html', 'PASS')], all, { platform: 'linux-x64-gles', update: true });
  assert.deepEqual(entryLines(run.written), [
    'webgl2 p.html FAIL [linux-x64 linux-arm64 macos-arm64 windows-x64 windows-arm64 linux-arm64-gles] # everywhere',
  ]);
});

test('Update on the OpenGL ES backend adds a failure for that platform alone', () => {
  const run = concludeRun(new Map(), [result('webgl2', 'p.html', 'FAIL')], pages({ webgl2: ['p.html'] }), {
    platform: 'linux-x64-gles',
    update: true,
  });
  assert.deepEqual(entryLines(run.written), ['webgl2 p.html FAIL [linux-x64-gles] # failed']);
});

test('OpenGL ES backend on Linux arm64: a linux-x64-gles entry does not apply', () => {
  const all = pages({ webgl2: ['p.html'] });
  const exp = parseExpectations('webgl2 p.html FAIL [linux-x64-gles] # x64 llvmpipe');
  const run = concludeRun(exp, [result('webgl2', 'p.html', 'PASS')], all, { platform: 'linux-arm64-gles', update: true });
  assert.equal(run.ok, true, 'the page is expected to pass there');
  assert.deepEqual(entryLines(run.written), ['webgl2 p.html FAIL [linux-x64-gles] # x64 llvmpipe']);
});

test('Update on Linux arm64 OpenGL ES adds a new failure for that platform alone', () => {
  const run = concludeRun(new Map(), [result('webgl2', 'p.html', 'FAIL')], pages({ webgl2: ['p.html'] }), {
    platform: 'linux-arm64-gles',
    update: true,
  });
  assert.deepEqual(entryLines(run.written), ['webgl2 p.html FAIL [linux-arm64-gles] # failed']);
});

test('Same failure on both OpenGL ES backend platforms: one entry lists both', () => {
  const exp = parseExpectations('webgl2 p.html FAIL [linux-x64-gles] # llvmpipe');
  const run = concludeRun(exp, [result('webgl2', 'p.html', 'FAIL')], pages({ webgl2: ['p.html'] }), {
    platform: 'linux-arm64-gles',
    update: true,
  });
  assert.deepEqual(entryLines(run.written), ['webgl2 p.html FAIL [linux-x64-gles linux-arm64-gles] # llvmpipe']);
});

test('Unknown platform: parsing fails naming the entry', () => {
  assert.throws(() => parseExpectations('webgl2 p.html FAIL [linux-riscv64] # x'), /:1: unknown platform linux-riscv64/);
  assert.throws(() => parseExpectations('webgl2 p.html FAIL [] # x'), /empty platform list/);
});

test('Overlapping entries: parsing fails naming them', () => {
  assert.throws(() => parseExpectations(`${X64}\nwebgl2 p.html TIMEOUT [windows-x64] # y`), /:2: entries for webgl2 p\.html overlap on windows-x64/);
  assert.throws(() => parseExpectations(`${X64}\nwebgl2 p.html TIMEOUT # y`), /:2: duplicate entry for webgl2 p\.html/);
  assert.throws(() => parseExpectations(`webgl2 p.html TIMEOUT # y\n${X64}`), /:2: duplicate entry for webgl2 p\.html/);
});

test('Entry limited to other platforms: the page is expected to PASS, and the entry is kept', () => {
  const exp = parseExpectations(X64);
  const all = pages({ webgl2: ['p.html'] });
  const run = concludeRun(exp, [result('webgl2', 'p.html', 'PASS')], all, { platform: 'linux-arm64' });
  assert.equal(run.ok, true);
  assert.deepEqual(run.stale, []);
  const updated = concludeRun(exp, [result('webgl2', 'p.html', 'PASS')], all, { platform: 'linux-arm64', update: true });
  assert.deepEqual(entryLines(updated.written), [X64]);
});

test('Entry limited to this platform: the page is expected to fail', () => {
  const exp = parseExpectations(X64);
  const all = pages({ webgl2: ['p.html'] });
  assert.equal(concludeRun(exp, [result('webgl2', 'p.html', 'FAIL')], all, { platform: 'linux-x64' }).ok, true);
  assert.equal(concludeRun(exp, [result('webgl2', 'p.html', 'PASS')], all, { platform: 'linux-x64' }).ok, false);
});

test('Different outcomes on different platforms: each platform expects its own', () => {
  const exp = parseExpectations(`${X64}\nwebgl2 p.html TIMEOUT [macos-arm64] # slow`);
  const all = pages({ webgl2: ['p.html'] });
  for (const [platform, outcome] of [['linux-x64', 'FAIL'], ['macos-arm64', 'TIMEOUT'], ['windows-arm64', 'PASS']]) {
    assert.equal(concludeRun(exp, [result('webgl2', 'p.html', outcome)], all, { platform }).ok, true, platform);
  }
});

test('a SKIP entry skips its page only on its platforms, and an update leaves it alone', () => {
  const exp = parseExpectations('webgl2 p.html SKIP [windows-arm64] # hangs');
  const all = pages({ webgl2: ['p.html'] });
  assert.deepEqual(selectPages(all, exp, { platform: 'windows-arm64' }).skipped, [{ suite: 'webgl2', path: 'p.html' }]);
  assert.deepEqual(selectPages(all, exp, { platform: 'linux-arm64' }).skipped, []);
  const run = concludeRun(exp, [result('webgl2', 'p.html', 'PASS')], all, { platform: 'windows-arm64', update: true });
  assert.deepEqual(entryLines(run.written), ['webgl2 p.html SKIP [windows-arm64] # hangs']);
});

test('Update after a platform starts failing: the platform joins the entry with that outcome', () => {
  const run = concludeRun(parseExpectations(X64), [result('webgl2', 'p.html', 'FAIL', 'new message')], pages({ webgl2: ['p.html'] }), {
    platform: 'macos-arm64',
    update: true,
  });
  assert.deepEqual(entryLines(run.written), ['webgl2 p.html FAIL [linux-x64 macos-arm64 windows-x64] # x64 only']);
});

test('an update with another outcome on an unlisted platform adds an entry for it alone', () => {
  const run = concludeRun(parseExpectations(X64), [result('webgl2', 'p.html', 'CRASH')], pages({ webgl2: ['p.html'] }), {
    platform: 'windows-arm64',
    update: true,
  });
  assert.deepEqual(entryLines(run.written), [X64, 'webgl2 p.html CRASH [windows-arm64] # crashed']);
});

test('Update after a platform starts passing: the platform leaves the entry', () => {
  const all = pages({ webgl2: ['p.html'] });
  const once = concludeRun(parseExpectations(X64), [result('webgl2', 'p.html', 'PASS')], all, { platform: 'windows-x64', update: true });
  assert.deepEqual(entryLines(once.written), ['webgl2 p.html FAIL [linux-x64] # x64 only']);
  const twice = concludeRun(once.written, [result('webgl2', 'p.html', 'PASS')], all, { platform: 'linux-x64', update: true });
  assert.deepEqual(entryLines(twice.written), []);
});

test('an update that completes a list writes the entry without platforms', () => {
  const exp = parseExpectations('webgl2 p.html FAIL [linux-x64 linux-arm64 macos-arm64 windows-x64 linux-x64-gles linux-arm64-gles] # x');
  const run = concludeRun(exp, [result('webgl2', 'p.html', 'FAIL')], pages({ webgl2: ['p.html'] }), { platform: 'windows-arm64', update: true });
  assert.deepEqual(entryLines(run.written), ['webgl2 p.html FAIL # x']);
});

test('an --update run of whole suites removes stale entries; a filtered one keeps them', () => {
  const exp = parseExpectations('webgl1 gone.html FAIL # removed upstream\nwebgl2 gone.html FAIL # other suite');
  const all = pages({ webgl1: ['p.html'] });
  const whole = concludeRun(exp, [result('webgl1', 'p.html', 'PASS')], all, { update: true });
  assert.equal(whole.ok, true);
  assert.deepEqual([...whole.written.keys()], ['webgl2 gone.html']);
  const filtered = concludeRun(exp, [result('webgl1', 'p.html', 'PASS')], all, { update: true, filtered: true });
  assert.deepEqual([...filtered.written.keys()], ['webgl1 gone.html', 'webgl2 gone.html']);
});

// --- Suite server -----------------------------------------------------------

/** Sends `path` verbatim (no client-side normalization); resolves to { status, body }. */
function get(origin, path) {
  return new Promise((done, fail) => {
    const req = request(`${origin}${path}`, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => done({ status: res.statusCode, body }));
    });
    req.path = path;
    req.on('error', fail);
    req.end();
  });
}

test('suite server serves files under the root, on loopback only, and refuses paths outside it', async () => {
  const server = await startServer(join(FIXTURES, 'suite'));
  try {
    assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.deepEqual(await get(server.origin, '/served.txt'), { status: 200, body: 'served\n' });
    assert.equal((await get(server.origin, '/missing.txt')).status, 404);
    for (const path of ['/..%2foutside.txt', '/%2e%2e%2foutside.txt', '/..%5coutside.txt', '/../outside.txt']) {
      const { status, body } = await get(server.origin, path);
      assert.notEqual(status, 200, path);
      assert.ok(!body.includes('outside the suite root'), path);
    }
  } finally {
    await server.close();
  }
});

// Bounded, so a response that never closes fails the test rather than hanging it.
test('suite server counts the bytes of the files it serves, and none for a refusal, a missing file or HEAD', { timeout: 10_000 }, async () => {
  const server = await startServer(join(FIXTURES, 'suite'));
  try {
    await get(server.origin, '/served.txt');
    await get(server.origin, '/missing.txt');
    await get(server.origin, '/../outside.txt');
    await new Promise((done, fail) => request(`${server.origin}/served.txt`, { method: 'HEAD' }, (res) => res.resume().on('end', done)).on('error', fail).end());
    // The server counts a response once it closes, which can follow the client's end.
    while (server.activity().inFlight > 0) await new Promise((done) => setImmediate(done));
    assert.equal(server.activity().bytes, 'served\n'.length);
  } finally {
    await server.close();
  }
});

// --- Page runner ------------------------------------------------------------

// Long enough that a page ending at once is clearly not waiting out the limit
// on slow hosts: starting a page process takes about 5 s on Windows runners,
// and over 20 s on a slow one when four start at once, and a host that collects
// core dumps (systemd-coredump) takes about 5 s to let an aborted page process
// exit.
const TIMEOUT_S = 40;
/** Pages that end without waiting must finish well inside the time limit. */
const PROMPT_MS = (TIMEOUT_S * 1000) / 2;

/** Runs fixture pages through the real pool and returns the report and written expectations. */
async function runFixtures(pages, expectationsText, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'oxgl-conformance-'));
  try {
    const reportPath = join(dir, 'report.json');
    const expectationsPath = join(dir, 'expectations.txt');
    const { ok } = await runConformance({
      root: join(FIXTURES, 'suite'),
      pages: new Map(Object.entries(pages)),
      expectations: parseExpectations(expectationsText),
      commit: 'fixture',
      timeoutS: TIMEOUT_S,
      jobs: 4,
      script: join(FIXTURES, 'faulty-page.mjs'),
      reportPath,
      expectationsPath,
      log: () => {},
      ...options,
    });
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const written = options.update ? parseExpectations(readFileSync(expectationsPath, 'utf8')) : undefined;
    return { ok, report, written };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const pageOf = (report, suite, path) => report.suites[suite].pages.find((p) => p.path === path);

test('page runner: outcomes, early errors, media, canvas shim, crashes, timeouts and harness errors', { timeout: 240_000 }, async () => {
  const { ok, report, written } = await runFixtures(
    {
      webgl1: [
        'pass.html',
        'fail-result.html',
        'no-results.html',
        'type-error.html',
        'error-never-completes.html',
        'recovers.html',
        'image.html',
        'markup-image.html',
        'canvas-defaults.html',
        'context-2d.html',
        'image-2d.html',
        'image-2d-jpeg.html',
        'image-undecodable.html',
        'image-icc-profile.html',
        'image-bitmap-svg.html',
        'image-bitmap-display-p3.html',
        'image-src-change.html',
        'image-upload-before-decode.html',
        'video.html',
        'video-frame.html',
        'messages.html',
        'rejected.html',
        'canvas-owner.html',
        'realm.html',
        'rejection.html',
        'destroy-throws.html',
        'frame.html',
        'frame-reload.html',
        'gc-dropped.html',
        'frame-error.html',
        'hang.html',
        'abort.html',
        'abort-at-teardown.html',
        'missing.html',
      ],
      webgl2: ['error-never-completes.html', 'webgl-version.html', 'frame-waits-for-gpu.html', 'frame-waits-for-gpu-worker.html'],
    },
    [
      'webgl1 fail-result.html FAIL # x',
      'webgl1 no-results.html FAIL # x',
      'webgl1 type-error.html FAIL # x',
      'webgl1 error-never-completes.html FAIL # x',
      'webgl1 image.html FAIL # x',
      'webgl1 markup-image.html FAIL # x',
      'webgl1 frame-error.html FAIL # x',
    ].join('\n'),
    { update: true },
  );
  const outcome = (suite, path) => pageOf(report, suite, path)?.outcome;

  assert.equal(outcome('webgl1', 'pass.html'), 'PASS');
  // Animation frames wait for queued GPU work: a fence from one frame is signaled in the next.
  for (const page of ['frame-waits-for-gpu.html', 'frame-waits-for-gpu-worker.html']) {
    assert.equal(outcome('webgl2', page), 'PASS', `${page}: ${pageOf(report, 'webgl2', page)?.message}`);
  }
  assert.equal(pageOf(report, 'webgl1', 'pass.html').passed, 2);
  assert.equal(outcome('webgl1', 'fail-result.html'), 'FAIL');
  assert.equal(pageOf(report, 'webgl1', 'fail-result.html').message, 'expected 1, got 2');
  assert.equal(outcome('webgl1', 'no-results.html'), 'FAIL');

  // Uncaught exception in a page expected to fail: FAIL at once.
  for (const path of ['type-error.html', 'error-never-completes.html']) {
    const page = pageOf(report, 'webgl1', path);
    assert.equal(page.outcome, 'FAIL', path);
    assert.match(page.message, /TypeError: gl\.\w+ is not a function/, path);
    assert.ok(page.durationMs < PROMPT_MS, `${path} took ${page.durationMs} ms`);
  }
  // Uncaught exception in a page expected to pass: keeps running, TIMEOUT, error recorded.
  const official = pageOf(report, 'webgl2', 'error-never-completes.html');
  assert.equal(official.outcome, 'TIMEOUT');
  assert.match(official.error, /^TypeError: gl\.bufferData is not a function/);
  assert.equal(entryOf(written, 'webgl2', 'error-never-completes.html').reason, 'no new result within the time limit: TypeError: gl.bufferData is not a function');
  // Page recovers from an uncaught exception: PASS, as in the official harness.
  assert.equal(outcome('webgl1', 'recovers.html'), 'PASS');
  assert.match(pageOf(report, 'webgl1', 'recovers.html').error, /error in a side callback/);

  // Missing image: error fires promptly.
  for (const path of ['image.html', 'markup-image.html']) {
    assert.equal(outcome('webgl1', path), 'FAIL', path);
    assert.match(pageOf(report, 'webgl1', path).message, /failed to load/, path);
    assert.ok(pageOf(report, 'webgl1', path).durationMs < PROMPT_MS, path);
  }

  // Default canvas size, unsupported context type, one context per canvas.
  assert.equal(outcome('webgl1', 'canvas-defaults.html'), 'PASS', pageOf(report, 'webgl1', 'canvas-defaults.html').message);
  // 2D context, one context type per canvas in both directions, ImageData.
  assert.equal(outcome('webgl1', 'context-2d.html'), 'PASS', pageOf(report, 'webgl1', 'context-2d.html').message);
  // Image drawn into a 2D canvas: natural size and decoded pixels.
  assert.equal(outcome('webgl1', 'image-2d.html'), 'PASS', pageOf(report, 'webgl1', 'image-2d.html').message);
  // A JPEG drawn from its load handler reads back its pixels; load waits for the decode.
  assert.equal(outcome('webgl1', 'image-2d-jpeg.html'), 'PASS', pageOf(report, 'webgl1', 'image-2d-jpeg.html').message);
  // Undecodable bytes fire error and never load.
  assert.equal(outcome('webgl1', 'image-undecodable.html'), 'PASS', pageOf(report, 'webgl1', 'image-undecodable.html').message);
  // A JPEG's color profile applies in 2D drawing and is ignored by WebGL uploads.
  assert.equal(outcome('webgl1', 'image-icc-profile.html'), 'PASS', pageOf(report, 'webgl1', 'image-icc-profile.html').message);
  // An ImageBitmap from an SVG image element.
  assert.equal(outcome('webgl1', 'image-bitmap-svg.html'), 'PASS', pageOf(report, 'webgl1', 'image-bitmap-svg.html').message);
  // An ImageBitmap converts into unpackColorSpace as other sources do.
  assert.equal(outcome('webgl1', 'image-bitmap-display-p3.html'), 'PASS', pageOf(report, 'webgl1', 'image-bitmap-display-p3.html').message);
  // A new source on the same element uploads the new image, not a copy of the old one.
  assert.equal(outcome('webgl1', 'image-src-change.html'), 'PASS', pageOf(report, 'webgl1', 'image-src-change.html').message);
  // An upload before the decode finishes is not cached, and decode() waits for the pixels.
  assert.equal(outcome('webgl1', 'image-upload-before-decode.html'), 'PASS', pageOf(report, 'webgl1', 'image-upload-before-decode.html').message);
  // A video that cannot load: play() rejects and error fires promptly.
  assert.equal(outcome('webgl1', 'video.html'), 'PASS', pageOf(report, 'webgl1', 'video.html').message);
  assert.ok(pageOf(report, 'webgl1', 'video.html').durationMs < PROMPT_MS);
  // A video decoded by ffmpeg: it plays, and its frame uploads.
  assert.equal(outcome('webgl1', 'video-frame.html'), 'PASS', pageOf(report, 'webgl1', 'video-frame.html').message);
  // Zero-timeout helper, message from a frame, mismatched target origin.
  assert.equal(outcome('webgl1', 'messages.html'), 'PASS', pageOf(report, 'webgl1', 'messages.html').message);
  // Creation rejected by oxgl: getContext returns null and the message is
  // recorded. Software rendering is always a major performance caveat; a GPU
  // host may create the context.
  if (process.env.OXGL_BACKEND === 'software') {
    assert.equal(outcome('webgl1', 'rejected.html'), 'PASS', pageOf(report, 'webgl1', 'rejected.html').message);
    assert.match(pageOf(report, 'webgl1', 'rejected.html').contextErrors[0], /failIfMajorPerformanceCaveat/);
  }
  // Context belongs to its canvas; resizes through property and attribute.
  assert.equal(outcome('webgl1', 'canvas-owner.html'), 'PASS', pageOf(report, 'webgl1', 'canvas-owner.html').message);
  // An unhandled rejection is ignored, as in a browser.
  assert.equal(outcome('webgl1', 'rejection.html'), 'PASS', pageOf(report, 'webgl1', 'rejection.html').message);
  // A throwing destroy() keeps the outcome and is recorded.
  assert.equal(outcome('webgl1', 'destroy-throws.html'), 'PASS');
  assert.match(pageOf(report, 'webgl1', 'destroy-throws.html').contextErrors[0], /destroy\(\) threw: Error: destroy failed/);
  // Frames get the shim, and their own results do not count for the page.
  const frame = pageOf(report, 'webgl1', 'frame.html');
  assert.equal(frame.outcome, 'PASS', frame.message);
  assert.deepEqual([frame.passed, frame.failed], [1, 0]);
  // Contexts the page drops are collected and released.
  assert.equal(outcome('webgl1', 'gc-dropped.html'), 'PASS', pageOf(report, 'webgl1', 'gc-dropped.html').message);
  // A frame's uncaught error is not the page's: the expected-FAIL page runs on.
  const frameError = pageOf(report, 'webgl1', 'frame-error.html');
  assert.equal(frameError.outcome, 'PASS', frameError.message);
  assert.equal(frameError.error, null);
  // A frame's contexts are released when it navigates.
  assert.equal(outcome('webgl1', 'frame-reload.html'), 'PASS', pageOf(report, 'webgl1', 'frame-reload.html').message);
  // Errors are the page's own types.
  assert.equal(outcome('webgl1', 'realm.html'), 'PASS', pageOf(report, 'webgl1', 'realm.html').message);
  // webgl2 pages load with webglVersion=2.
  assert.equal(outcome('webgl2', 'webgl-version.html'), 'PASS');

  // Page never finishes, native crash, crash after reporting.
  assert.equal(outcome('webgl1', 'hang.html'), 'TIMEOUT');
  assert.equal(pageOf(report, 'webgl1', 'hang.html').passed, 1, 'counts survive a timeout');
  assert.equal(outcome('webgl1', 'abort.html'), 'CRASH');
  assert.equal(outcome('webgl1', 'abort-at-teardown.html'), 'CRASH');
  assert.match(pageOf(report, 'webgl1', 'abort-at-teardown.html').message, /SIGABRT|code 3\b|code 134\b/);

  // Page setup fails: a harness error, not an outcome or an expectation.
  assert.equal(ok, false);
  assert.deepEqual(report.harnessErrors.map((h) => h.path), ['missing.html']);
  assert.equal(outcome('webgl1', 'missing.html'), 'HARNESS_ERROR');
  assert.equal(entryOf(written, 'webgl1', 'missing.html'), undefined);
  assert.equal(entryOf(written, 'webgl1', 'abort.html').outcome, 'CRASH');
  assert.equal(entryOf(written, 'webgl1', 'hang.html').outcome, 'TIMEOUT');

  // Results report fields.
  for (const field of ['commit', 'backend', 'idleTimeoutSeconds', 'jobs', 'platform', 'timestamp']) {
    assert.ok(report[field] !== undefined, field);
  }
  assert.equal(report.backend, process.env.OXGL_BACKEND || 'auto');
  assert.equal(report.idleTimeoutSeconds, TIMEOUT_S);
  assert.equal(report.jobs, 4);
  for (const field of ['outcome', 'passed', 'failed', 'durationMs', 'maxGapMs', 'message']) {
    assert.ok(field in pageOf(report, 'webgl1', 'fail-result.html'), field);
  }
});

test('Closure imports run in browser order and fail on their own', async () => {
  const { report } = await runFixtures(
    { webgl1: ['closure-order.html', 'closure-throws.html', 'closure-missing.html', 'closure-cross-origin.html'] },
    ['webgl1 closure-missing.html FAIL # x', 'webgl1 closure-cross-origin.html FAIL # x'].join('\n'),
  );
  // deqp namespace defined before the page uses it.
  const order = pageOf(report, 'webgl1', 'closure-order.html');
  assert.equal(order.outcome, 'PASS', order.message ?? order.error);
  // Error in an imported file: recorded, naming the file, and later imports still run.
  const throws = pageOf(report, 'webgl1', 'closure-throws.html');
  assert.equal(throws.outcome, 'PASS', throws.message);
  assert.match(throws.error, /^Error: import failed\n\s+at \S*\/closure\/throws\.js:1/);
  // Imported file missing or on another origin: not run, and not a harness error.
  for (const path of ['closure-missing.html', 'closure-cross-origin.html']) {
    const page = pageOf(report, 'webgl1', path);
    assert.equal(page.outcome, 'FAIL', path);
    assert.match(page.message, /ReferenceError: fixture is not defined/, path);
  }
  assert.deepEqual(report.harnessErrors, []);
});

test('--fast-errors ends every page at its first error', async () => {
  const { report } = await runFixtures({ webgl1: ['recovers.html'] }, '', { fastErrors: true });
  assert.equal(pageOf(report, 'webgl1', 'recovers.html').outcome, 'FAIL');
});

test('Report after a failed run: the regressed page\'s failure message is in the report', async () => {
  const { ok, report } = await runFixtures({ webgl1: ['fail-result.html', 'pass.html'] }, '');
  assert.equal(ok, false);
  assert.deepEqual(report.unexpected, [{ suite: 'webgl1', path: 'fail-result.html', expected: 'PASS', outcome: 'FAIL' }]);
  assert.equal(pageOf(report, 'webgl1', 'fail-result.html').message, 'expected 1, got 2');
});

test('Report entries record the reason of the expectation that applied', async () => {
  const other = PLATFORMS.find((p) => p !== hostPlatform());
  const { report } = await runFixtures(
    { webgl1: ['fail-result.html', 'pass.html', 'skipped.html'] },
    [
      'webgl1 fail-result.html FAIL # known: the fixture fails',
      `webgl1 pass.html FAIL [${other}] # only on another platform`,
      'webgl1 skipped.html SKIP # not run here',
    ].join('\n'),
  );
  assert.equal(pageOf(report, 'webgl1', 'fail-result.html').reason, 'known: the fixture fails');
  // An entry limited to another platform doesn't apply, so there's no reason.
  assert.equal(pageOf(report, 'webgl1', 'pass.html').reason, null);
  assert.deepEqual(pageOf(report, 'webgl1', 'skipped.html'), { path: 'skipped.html', expected: 'SKIP', reason: 'not run here', outcome: 'SKIP' });
});

test('page URLs carry the suite\'s WebGL version', () => {
  assert.equal(pageURL('http://127.0.0.1:1', 'webgl2', 'conformance/a.html'), 'http://127.0.0.1:1/conformance/a.html?webglVersion=2');
  assert.equal(pageURL('http://127.0.0.1:1', 'webgl1', 'a.html?x=1'), 'http://127.0.0.1:1/a.html?x=1&webglVersion=1');
});

test('Hang while tearing down: a completed page that does not exit is CRASH', async () => {
  const server = await startServer(join(FIXTURES, 'suite'));
  try {
    const [result] = await runPages([{ suite: 'webgl1', path: 'hang-at-teardown.html', expected: 'PASS' }], {
      origin: server.origin,
      jobs: 1,
      timeoutMs: TIMEOUT_S * 1000,
      teardownMs: 1000,
      script: join(FIXTURES, 'faulty-page.mjs'),
    });
    assert.equal(result.outcome, 'CRASH');
    assert.match(result.message, /reported PASS, then did not exit within 1 s/);
  } finally {
    await server.close();
  }
});

// --- Command ----------------------------------------------------------------

const neverFetch = () => assert.fail('the suite must not be fetched');

test('the command rejects bad options before fetching the suite', async () => {
  await assert.rejects(main(['--suite', 'webgl3'], { fetchSuite: neverFetch }), /unknown suite webgl3/);
  await assert.rejects(main(['--timeout', '0'], { fetchSuite: neverFetch }), /--timeout must be a positive number/);
  await assert.rejects(main(['--jobs', '0'], { fetchSuite: neverFetch }), /--jobs must be a positive integer/);
  await assert.rejects(main(['--bogus'], { fetchSuite: neverFetch }), /Unknown option '--bogus'/);
  assert.equal(await main(['--help'], { fetchSuite: neverFetch }), 0);
});

test('Canvas package missing: the command stops before any page, naming canvas and npm ci', async () => {
  const missing = () => {
    throw new Error("Cannot find module 'canvas'");
  };
  await assert.rejects(main([], { fetchSuite: neverFetch, loadCanvas: missing }), /'canvas' package.*npm ci/);
});

test('ffmpeg missing: the command stops before any page, naming ffmpeg', async () => {
  await assert.rejects(main([], { fetchSuite: neverFetch, hasFfmpeg: false }), /ffmpeg.*cannot be run/);
});

test('Entry without a reason: the command fails before running any page', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oxgl-conformance-'));
  try {
    const expectationsPath = join(dir, 'expectations.txt');
    writeFileSync(expectationsPath, 'webgl1 conformance/a.html FAIL\n');
    await assert.rejects(main([], { expectationsPath, fetchSuite: neverFetch, hasFfmpeg: true }), /:1: webgl1 conformance\/a\.html has no reason/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Suite fetch ------------------------------------------------------------

/** A local repository with an sdk/tests tree, standing in for KhronosGroup/WebGL. */
function fixtureRepository(dir) {
  const repo = join(dir, 'webgl');
  mkdirSync(join(repo, 'sdk', 'tests'), { recursive: true });
  writeFileSync(join(repo, 'sdk', 'tests', '00_test_list.txt'), 'conformance/00_test_list.txt\n');
  writeFileSync(join(repo, 'README.md'), 'outside sdk/tests\n');
  // As in three.js: text files are normalized, so the checkout's line endings
  // follow core.eol.
  writeFileSync(join(repo, '.gitattributes'), '* text=auto\n');
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('config', 'uploadpack.allowAnySHA1InWant', 'true');
  git('config', 'uploadpack.allowFilter', 'true');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'suite');
  return { repository: `file://${repo}`, commit: git('rev-parse', 'HEAD'), versions: { webgl1: '1.0.4', webgl2: '2.0.1' } };
}

test('Suite fetched by pinned commit: sparse copy, reused, abandoned and incomplete copies cleaned', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oxgl-conformance-'));
  try {
    const pin = fixtureRepository(dir);
    const cache = join(dir, 'cache');
    const scratch = (pid) => join(cache, `${pin.commit}.partial-${pid}`);
    mkdirSync(scratch(process.ppid), { recursive: true }); // a live run's: kept
    mkdirSync(scratch(2 ** 22 + 1), { recursive: true }); // a dead pid's: removed
    mkdirSync(scratch(process.pid + 1), { recursive: true }); // old: removed whatever its pid
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(scratch(process.pid + 1), old, old);
    mkdirSync(join(cache, pin.commit, 'sdk'), { recursive: true }); // incomplete: replaced

    const tests = ensureSuite(pin, cache);
    assert.equal(tests, join(cache, pin.commit, 'sdk', 'tests'));
    assert.ok(existsSync(join(tests, '00_test_list.txt')));
    assert.ok(!existsSync(join(cache, pin.commit, 'README.md')), 'only sdk/tests is checked out');
    assert.ok(existsSync(scratch(process.ppid)));
    assert.ok(!existsSync(scratch(2 ** 22 + 1)));
    assert.ok(!existsSync(scratch(process.pid + 1)));
    assert.ok(!existsSync(scratch(process.pid)));

    // A later run reuses the copy without touching the repository.
    assert.equal(ensureSuite({ ...pin, repository: 'file:///nonexistent' }, cache), tests);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Checkout with its own paths and marker: only those paths, reused once the marker exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oxgl-conformance-'));
  try {
    const pin = fixtureRepository(dir);
    const cache = join(dir, 'cache');
    mkdirSync(join(cache, pin.commit), { recursive: true }); // no marker: replaced
    const checkout = ensureCheckout(pin, cache, { paths: ['/README.md'], marker: 'README.md' });
    assert.equal(checkout, join(cache, pin.commit));
    assert.ok(existsSync(join(checkout, 'README.md')));
    assert.ok(!existsSync(join(checkout, 'sdk')), 'only the named paths are checked out');
    assert.equal(ensureCheckout({ ...pin, repository: 'file:///nonexistent' }, cache, { paths: ['/README.md'], marker: 'README.md' }), checkout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Windows host converting line endings: the checkout has the commit\'s bytes', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'oxgl-conformance-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pin = fixtureRepository(dir);
  // Git for Windows' usual configuration, in the environment of the git
  // commands ensureCheckout starts.
  const saved = { ...process.env };
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });
  Object.assign(process.env, {
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.autocrlf',
    GIT_CONFIG_VALUE_0: 'true',
    GIT_CONFIG_KEY_1: 'core.eol',
    GIT_CONFIG_VALUE_1: 'crlf',
  });
  const tests = ensureSuite(pin, join(dir, 'cache'));
  assert.equal(readFileSync(join(tests, '00_test_list.txt'), 'utf8'), 'conformance/00_test_list.txt\n');
});

const LIMIT_MS = 3000;

test('Long page that keeps reporting: the time limit counts from the last result', async () => {
  // The clock starts at fork, so the limit also covers process startup and
  // page load; 3 s leaves room for a loaded CI runner.
  const server = await startServer(join(FIXTURES, 'suite'));
  try {
    const run = (path) =>
      runPages([{ suite: 'webgl1', path, expected: 'PASS' }], { origin: server.origin, jobs: 2, timeoutMs: LIMIT_MS, script: join(FIXTURES, 'faulty-page.mjs') });
    const [steady] = await run('steady.html');
    assert.equal(steady.outcome, 'PASS', steady.message);
    assert.ok(steady.durationMs > LIMIT_MS, `ran ${steady.durationMs} ms`);
    assert.ok(steady.maxGapMs < LIMIT_MS, `longest gap ${steady.maxGapMs} ms`);
    // Results reported in one long synchronous stretch restart the watchdog too.
    const [busy] = await run('busy.html');
    assert.equal(busy.outcome, 'PASS', busy.message);
    assert.ok(busy.durationMs > LIMIT_MS && busy.maxGapMs < LIMIT_MS, `ran ${busy.durationMs} ms, longest gap ${busy.maxGapMs} ms`);
    // One result, then silence: timed out about a limit after that result.
    const [hang] = await run('hang.html');
    assert.equal(hang.outcome, 'TIMEOUT');
    assert.equal(hang.message, `no new result for ${LIMIT_MS / 1000} s`);
    assert.equal(hang.limit, 'idle');
    assert.equal(hang.passed, 1);
  } finally {
    await server.close();
  }
});

test('Total limit: a page that keeps reporting is timed out once it has run that long', async () => {
  const server = await startServer(join(FIXTURES, 'suite'));
  try {
    const [steady] = await runPages([{ suite: 'webgl1', path: 'steady.html', expected: 'PASS' }], {
      origin: server.origin,
      timeoutMs: LIMIT_MS,
      totalMs: 1500,
      script: join(FIXTURES, 'faulty-page.mjs'),
    });
    assert.equal(steady.outcome, 'TIMEOUT');
    assert.equal(steady.limit, 'total');
    assert.equal(steady.message, 'ran 1.5 s in total');
    assert.ok(steady.durationMs < LIMIT_MS, `ran ${steady.durationMs} ms`);
  } finally {
    await server.close();
  }
});

test('page processes get the arguments and Node options the runner asks for', async () => {
  const [record] = await runPages([{ suite: 'webgl1', path: 'pass.html', expected: 'PASS' }], {
    origin: 'http://127.0.0.1:1',
    timeoutMs: LIMIT_MS,
    script: join(FIXTURES, 'argv-page.mjs'),
    args: (page, endEarly) => [page.path, String(endEarly)],
    execArgv: ['--experimental-vm-modules'],
  });
  assert.equal(record.outcome, 'PASS');
  const { args, execArgv } = JSON.parse(record.message);
  assert.deepEqual(args, ['pass.html', 'false']);
  assert.ok(execArgv.includes('--experimental-vm-modules'), JSON.stringify(execArgv));
});
