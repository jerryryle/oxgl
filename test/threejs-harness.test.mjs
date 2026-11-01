// The three.js example runner's own tests: suite listing, the example page
// (window, modules, assets), the deterministic frame, capture, comparison,
// outcomes, expectations and the command.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { applicable, concludeRun, formatExpectations, judge, parseExpectations, updateExpectations } from '../conformance/expectations.mjs';
import { defaultJobs, runPages } from '../conformance/pool.mjs';
import { startServer } from '../conformance/server.mjs';
import { crossOrigin, workerClass } from '../conformance/workers.mjs';
import { compare, composite, halve, matches, parseColor } from '../threejs/image.mjs';
import { listExamples } from '../threejs/release.mjs';
import { main as threejsMain, parseThreejsExpectations, runThreejs } from '../threejs/run.mjs';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'threejs');
const THREE = join(import.meta.dirname, '..', 'node_modules', 'three');
const EXAMPLE = join(import.meta.dirname, '..', 'threejs', 'example.mjs');
const BLUE = [0, 128, 255];

test('The example suite: every example page except index.html and the WebGPU examples', () => {
  assert.deepEqual(listExamples(join(FIXTURES, 'listing')), ['misc_controls_orbit', 'webgl_animation_keyframes']);
});

// --- Images ----------------------------------------------------------------

/** A solid `width × height` image of `rgba`. */
function filled(width, height, [r, g, b, a = 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([r, g, b, a], i);
  return { data, width, height };
}

test('composite: a transparent frame shows the body background, white when it is transparent', () => {
  const clear = filled(2, 2, [0, 0, 0, 0]);
  assert.deepEqual([...composite(clear, 'rgb(0, 0, 0)').data.slice(0, 4)], [0, 0, 0, 255]);
  assert.deepEqual([...composite(clear, 'rgb(255, 255, 255)').data.slice(0, 4)], [255, 255, 255, 255]);
  assert.deepEqual([...composite(clear, 'rgba(0, 0, 0, 0)').data.slice(0, 4)], [255, 255, 255, 255]);
  assert.deepEqual([...composite(filled(1, 1, [255, 0, 0, 128]), 'rgb(0, 0, 255)').data], [128, 0, 127, 255]);
  assert.deepEqual(parseColor('rgba(1, 2, 3, 0.5)'), { r: 1, g: 2, b: 3, a: 0.5 });
});

test('halve: 2×2 blocks are averaged', () => {
  const image = { data: new Uint8ClampedArray([0, 0, 0, 255, 100, 0, 0, 255, 0, 200, 0, 255, 0, 0, 40, 255]), width: 2, height: 2 };
  assert.deepEqual(halve(image), { data: new Uint8ClampedArray([25, 50, 10, 255]), width: 1, height: 1 });
});

test('compare: per-pixel distance above 0.1, and the tolerance itself matches', () => {
  const base = filled(100, 10, [100, 100, 100]);
  // 25 on every channel is 0.098 of the maximum distance, 26 is 0.102.
  assert.equal(compare(filled(100, 10, [125, 125, 125]), base).percent, 0);
  assert.equal(compare(filled(100, 10, [126, 126, 126]), base).percent, 100);
  const off = { ...base, data: base.data.slice() };
  off.data.set([255, 0, 0, 255], 0); // one pixel in 1000: 0.1%
  const { percent, diff } = compare(off, base);
  assert.equal(percent, 0.1);
  assert.deepEqual([...diff.data.slice(0, 8)], [255, 0, 0, 255, 20, 20, 20, 255]);
  assert.ok(matches(percent), 'exactly 0.1% matches the default tolerance');
  assert.ok(!matches(0.11));
  assert.ok(matches(1.4, 2) && !matches(4, 2));
  assert.equal(compare(filled(2, 2, BLUE), filled(4, 4, BLUE)), undefined, 'sizes differ');
});

// --- Expectations ----------------------------------------------------------

const OPTIONS = { suite: 'threejs', tolerances: true };
const parse = (text) => parseExpectations(text, 'expectations.txt', OPTIONS);
const PAGES = new Map([['threejs', ['a', 'b', 'c']]]);
/** A result as the runner gives it to the judge. */
const result = (path, outcome, diffPercent, { imageOnly = outcome === 'FAIL', message } = {}) => ({
  suite: 'threejs',
  path,
  outcome,
  diffPercent,
  imageOnly,
  message: message ?? (outcome === 'FAIL' ? `${String(diffPercent)}% of pixels differ` : undefined),
});

test('Checked-in expectations: no suite column, DIFF entries and their bounds, and reasons', () => {
  const entries = parse('# comment\na FAIL # broken\nb DIFF 2% # noise\nc SKIP # slow\n');
  assert.deepEqual(entries.get('threejs b'), { suite: 'threejs', path: 'b', outcome: 'DIFF', tolerance: 2, reason: 'noise' });
  assert.equal(entries.get('threejs a').outcome, 'FAIL');
  assert.equal(parse(formatExpectations(entries, { suite: 'threejs', header: ['# h'] })).get('threejs b').tolerance, 2);
  assert.match(formatExpectations(entries, { suite: 'threejs', header: [] }), /^b DIFF 2% # noise$/m);
  assert.throws(() => parse('a FAIL\n'), /a has no reason/);
  assert.throws(() => parse('a DIFF 20% # far off\n'), /a has DIFF 20%/);
  assert.throws(() => parse('a DIFF 0.1% # too tight\n'), /a has DIFF 0.1%/);
  assert.throws(() => parseExpectations('a DIFF 2% # x\n', 'expectations.txt', { suite: 'threejs' }), /unknown outcome DIFF/);
});

test('Tolerance entries and judging: within the tolerance passes, beyond it regresses, within 0.1% is unexpected', () => {
  const entries = parse('a DIFF 2% # noise\nb FAIL # broken\n');
  const verdict = (results) => judge(entries, results, PAGES, { filtered: true }).unexpected.map((u) => `${u.path} ${u.expected}`);
  assert.deepEqual(verdict([result('a', 'PASS', 1.4), result('b', 'FAIL', 30), result('c', 'PASS', 0.1)]), []);
  assert.deepEqual(verdict([result('a', 'FAIL', 4)]), ['a DIFF 2%']);
  assert.deepEqual(verdict([result('a', 'PASS', 0.1), result('b', 'PASS', 0)]), ['a DIFF 2%', 'b FAIL']);
  assert.deepEqual(judge(entries, [], new Map([['threejs', ['a']]])).stale.map((e) => e.path), ['b']);
  assert.deepEqual(judge(entries, [], new Map([['threejs', ['a']]]), { filtered: true }).stale, []);
});

test('Updating expectations: tolerances kept, never raised, given to new and fixed image-only failures', () => {
  const entries = parse('a DIFF 2% # noise\nb FAIL # shader error\nc DIFF 3% # noise\n');
  const pages = new Map([['threejs', ['a', 'b', 'c', 'd', 'e', 'f']]]);
  const next = updateExpectations(
    entries,
    [
      result('a', 'PASS', 1.4), // Update keeps a tolerance in use
      result('b', 'FAIL', 1.8), // Fixed failure gets a tolerance
      result('c', 'FAIL', 4.3, { message: '4.30% of pixels differ (tolerance 3%)' }), // Update does not loosen a tolerance
      result('d', 'FAIL', 0.3), // a new image-only failure
      result('e', 'FAIL', 12), // too far off to call noise
      result('f', 'FAIL', 0, { imageOnly: false, message: 'TypeError: x is undefined\n  at y' }),
    ],
    pages,
    { tolerances: true },
  );
  // An update narrows an entry for every platform to the host's own result.
  const here = applicable(next);
  const line = (path) => {
    const e = here.get(`threejs ${path}`);
    return e === undefined ? undefined : `${e.outcome}${e.tolerance === undefined ? '' : ` ${String(e.tolerance)}%`} # ${e.reason}`;
  };
  assert.equal(line('a'), 'DIFF 2% # noise');
  assert.equal(line('b'), 'DIFF 2% # 1.80% of pixels differ');
  assert.equal(line('c'), 'FAIL # 4.30% of pixels differ (tolerance 3%)');
  assert.equal(line('d'), 'DIFF 1% # 0.30% of pixels differ');
  assert.equal(line('e'), 'FAIL # 12% of pixels differ');
  assert.equal(line('f'), 'FAIL # TypeError: x is undefined');
  // Within 0.1%, a DIFF entry goes; and an update run is judged against what it writes.
  assert.equal(applicable(updateExpectations(entries, [result('a', 'PASS', 0.05)], pages, { tolerances: true })).has('threejs a'), false);
  assert.ok(concludeRun(entries, [result('c', 'FAIL', 4.3)], pages, { filtered: true, update: true, tolerances: true }).ok);
  // A new tolerance is judged by the difference, not by the outcome its
  // process reported against the default tolerance it ran with.
  assert.ok(concludeRun(entries, [result('d', 'FAIL', 0.3)], pages, { filtered: true, update: true, tolerances: true }).ok);
  assert.equal(applicable(updateExpectations(entries, [result('a', 'FAIL', 1.5)], pages, { tolerances: true })).get('threejs a').reason, 'noise');
});

// --- Example runs ----------------------------------------------------------

let root;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'oxgl-threejs-'));
  cpSync(join(FIXTURES, 'release'), root, { recursive: true });
  symlinkSync(join(THREE, 'build'), join(root, 'build'));
  symlinkSync(join(THREE, 'examples', 'jsm'), join(root, 'examples', 'jsm'));
  const screenshots = join(root, 'examples', 'screenshots');
  mkdirSync(screenshots);
  const { createCanvas } = createRequire(import.meta.url)('canvas');
  const reference = (name, [r, g, b]) => {
    const canvas = createCanvas(400, 250);
    const context = canvas.getContext('2d');
    context.fillStyle = `rgb(${r}, ${g}, ${b})`;
    context.fillRect(0, 0, 400, 250);
    writeFileSync(join(screenshots, `${name}.jpg`), canvas.toBuffer('image/jpeg', { quality: 0.95 }));
  };
  for (const name of ['solid', 'no-loop', 'modules', 'load-events', 'three', 'embedded', 'console-error', 'remote', 'worker-remote', 'polling', 'throws', 'two-canvases', 'small-canvas']) {
    reference(name, BLUE);
  }
  reference('transparent-black', [0, 0, 0]);
  reference('transparent-white', [255, 255, 255]);
});

after(() => rmSync(root, { recursive: true, force: true }));

/** Runs one fixture example in its own process; resolves to the pool's record. */
async function run(name, { script = EXAMPLE, tolerance, output, timing, timeoutMs = 20_000, totalMs } = {}) {
  const [record] = await runPages([{ suite: 'threejs', path: name, expected: 'PASS' }], {
    script,
    args: (page) => [page.path, JSON.stringify({ root, tolerance, output, timing })],
    execArgv: ['--experimental-vm-modules', '--disable-warning=ExperimentalWarning'],
    timeoutMs,
    totalMs,
  });
  return record;
}

const passes = (record) => assert.equal(record.outcome, 'PASS', record.message ?? record.harnessError);

test('Renderer sized to the window, and importing three and its addons', async () => {
  // three.html sizes its renderer from the window and imports OrbitControls
  // through the import map; anything else would not capture or not load.
  const record = await run('three');
  passes(record);
  assert.ok(record.extra.diffPercent <= 0.1);
});

test('Module scripts: import maps, prefixes, exact keys, cycles, dynamic import and the page realm', async () => {
  passes(await run('modules'));
});

test('Error in a module: the error is the example\'s escaped error', async () => {
  const record = await run('throws');
  assert.equal(record.outcome, 'FAIL');
  assert.match(record.message, /module failed on purpose/);
  assert.equal(record.extra.imageOnly, false);
});

test('Module waiting for load: DOMContentLoaded and load run once, after the module, even when jsdom fires load again, in both listener orders', async () => {
  passes(await run('load-events', { script: join(FIXTURES, 'faulty-example.mjs') }));
  passes(await run('load-events', { script: join(FIXTURES, 'hold-first-example.mjs') }));
});

test('Remote asset: refused without contacting the host, and named', async () => {
  const record = await run('remote');
  assert.equal(record.outcome, 'FAIL');
  assert.equal(record.extra.refused, 'http://example.invalid/texture.png');
});

test('Remote fetch from a worker: refused and named', async () => {
  const record = await run('worker-remote');
  assert.equal(record.extra.refused, 'http://example.invalid/data');
});

test('Embedded and Blob URLs: both load, nothing refused', async () => {
  const record = await run('embedded');
  passes(record);
  assert.equal(record.extra.refused, undefined);
});

test('a worker without the same-origin option still fetches from another origin', async () => {
  const server = await startServer(join(import.meta.dirname, 'fixtures', 'conformance', 'suite'));
  try {
    const other = server.origin.replace('127.0.0.1', 'localhost');
    assert.ok(crossOrigin(`${other}/served.txt`, server.origin));
    assert.ok(!crossOrigin('data:,x', server.origin) && !crossOrigin('blob:http://127.0.0.1/x', server.origin));
    const Worker = workerClass({
      EventTarget,
      messageEvent: (data) => Object.assign(new Event('message'), { data }),
      errorEvent: (message) => Object.assign(new Event('error'), { message }),
      base: () => `${server.origin}/`,
      receive: (data) => data,
    });
    const source = `fetch(${JSON.stringify(`${other}/served.txt`)}).then((r) => r.text()).then(postMessage, (e) => postMessage('refused: ' + e.message));`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    const text = await new Promise((resolve) => worker.addEventListener('message', (event) => resolve(event.data)));
    worker.terminate();
    assert.equal(text.trim(), readFileSync(join(import.meta.dirname, 'fixtures', 'conformance', 'suite', 'served.txt'), 'utf8').trim());

    // With the option, a URL that does not resolve against the worker's Blob
    // URL rejects, as a browser's fetch does, rather than throwing.
    const Restricted = workerClass({
      EventTarget,
      messageEvent: (data) => Object.assign(new Event('message'), { data }),
      errorEvent: (message) => Object.assign(new Event('error'), { message }),
      base: () => `${server.origin}/`,
      receive: (data) => data,
      origin: server.origin,
    });
    const relative = `try { fetch('served.txt').then(() => postMessage('fetched'), () => postMessage('rejected')); } catch { postMessage('threw'); }`;
    const restricted = new Restricted(URL.createObjectURL(new Blob([relative], { type: 'text/javascript' })));
    const how = await new Promise((resolve) => restricted.addEventListener('message', (event) => resolve(event.data)));
    restricted.terminate();
    assert.equal(how, 'rejected');
  } finally {
    await server.close();
  }
});

test('Seeded randomness: two runs capture the same frame', async () => {
  const output = join(root, 'output-seeded');
  // seeded has no reference, so each run writes its frame.
  const first = await run('seeded', { output });
  assert.match(first.message, /no reference screenshot/);
  const frame = readFileSync(join(output, 'seeded-actual.png'));
  await run('seeded', { output });
  assert.deepEqual(readFileSync(join(output, 'seeded-actual.png')), frame);
});

test('Example without an animation loop: judged on the frame it rendered on load, not cleared', async () => {
  const record = await run('no-loop', { timing: { renderWaitMs: 300 } });
  passes(record);
});

test('Large assets: the parse allowance is capped, so the runner\'s own waits do not time it out', async () => {
  // A rate of 10 minutes per megabyte would wait far past the limit without the cap.
  const started = performance.now();
  const record = await run('solid', { timing: { allowanceMsPerMB: 600_000, allowanceCapMs: 200 }, timeoutMs: 5000 });
  passes(record);
  assert.ok(performance.now() - started < 5000);
});

test('The captured frame: two canvases, a wrongly sized canvas, and transparent frames over the body', async () => {
  const two = await run('two-canvases');
  assert.equal(two.outcome, 'FAIL');
  assert.match(two.message, /cannot be captured from more than one canvas/);
  const small = await run('small-canvas');
  assert.match(small.message, /300×150, not 800×500/);
  passes(await run('transparent-black'));
  passes(await run('transparent-white'));
});

test('Missing reference and images of failing examples', async () => {
  const output = join(root, 'output-images');
  const record = await run('solid', { output, tolerance: 0.1, timing: {} });
  passes(record);
  assert.ok(!existsSync(join(output, 'solid-actual.png')), 'a passing example writes no images');
  const failing = await run('console-error', { output });
  assert.equal(failing.outcome, 'FAIL');
  for (const kind of ['actual', 'expected', 'diff']) assert.ok(existsSync(join(output, `console-error-${kind}.png`)), kind);
});

test('Shader compile error: console.error fails an example whose frame matches', async () => {
  const record = await run('console-error');
  assert.equal(record.outcome, 'FAIL');
  assert.equal(record.message, 'THREE.WebGLProgram: Shader Error 0 - VALIDATE_STATUS false');
  assert.ok(record.extra.diffPercent <= 0.1);
  assert.equal(record.extra.imageOnly, false);
});

test('Example that never finishes: no progress is a TIMEOUT at the limit without progress', async () => {
  const record = await run('busy', { timeoutMs: 3000 });
  assert.equal(record.outcome, 'TIMEOUT');
  assert.equal(record.limit, 'idle');
});

test('Example that never goes idle: a TIMEOUT at the total limit', async () => {
  const record = await run('polling', { timeoutMs: 3000, totalMs: 4000 });
  assert.equal(record.outcome, 'TIMEOUT');
  assert.equal(record.limit, 'total');
});

test('A video that fails, as upstream reports it, fails the example rather than the runner', async () => {
  const record = await run('video-error');
  assert.equal(record.outcome, 'FAIL', record.harnessError);
  assert.match(record.message, /video failed to decode/);
});

test('Unhandled rejections: the page\'s fail the example, the runner\'s are harness errors', async () => {
  const page = await run('page-rejection');
  assert.equal(page.outcome, 'FAIL', page.harnessError);
  assert.match(page.message, /^Uncaught \(in promise\) Error: page rejected/);
  // An error of the runner's realm raised under page code is the example's.
  const library = await run('node-error', { script: join(FIXTURES, 'faulty-example.mjs') });
  assert.equal(library.outcome, 'FAIL', library.harnessError);
  assert.match(library.message, /^Uncaught \(in promise\) Error: thrown by a Node-side library/);
  const runner = await run('runner-rejection', { script: join(FIXTURES, 'faulty-example.mjs') });
  assert.equal(runner.outcome, undefined);
  assert.match(runner.harnessError, /a runner bug/);
});

test('Native crash in one example: CRASH, and the next example runs', async () => {
  const crashed = await run('crash', { script: join(FIXTURES, 'faulty-example.mjs') });
  assert.equal(crashed.outcome, 'CRASH');
  passes(await run('solid'));
});

test('Setup fails: a harness error, not an outcome', async () => {
  const [record] = await runPages([{ suite: 'threejs', path: 'solid', expected: 'PASS' }], {
    script: EXAMPLE,
    args: (page) => [page.path, JSON.stringify({ root: join(root, 'missing') })],
    execArgv: ['--experimental-vm-modules', '--disable-warning=ExperimentalWarning'],
    timeoutMs: 10_000,
  });
  assert.equal(record.outcome, undefined);
  assert.match(record.harnessError, /deterministic-injection/);
});

// --- The command -----------------------------------------------------------

/** Runs the command's core over fixture examples; resolves to `{ ok, report, written }`. */
async function command(examples, expectationsText, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'oxgl-threejs-run-'));
  try {
    const reportPath = join(dir, 'report.json');
    const expectationsPath = join(dir, 'expectations.txt');
    const { ok } = await runThreejs({
      root,
      examples,
      expectations: parseThreejsExpectations(expectationsText),
      pin: { tag: 'fixture', commit: 'fixture' },
      jobs: 2,
      reportPath,
      expectationsPath,
      outputDir: join(dir, 'output'),
      log: () => {},
      ...options,
    });
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const written = options.update ? readFileSync(expectationsPath, 'utf8') : undefined;
    return { ok, report, written };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Filtered run: only matching examples run, other entries are neither checked nor stale', async () => {
  const { ok, report } = await command(['solid', 'no-loop', 'gone'], 'no-loop FAIL # would be an unexpected pass\ngone FAIL # not run\n', { filter: 'solid' });
  assert.ok(ok);
  assert.deepEqual(report.examples.map((e) => e.name), ['solid']);
  assert.deepEqual(report.stale, []);
  assert.equal(report.jobs, 2);
  assert.equal(report.tag, 'fixture');
});

test('Raising the total limit: a slow example is judged instead of timing out, and the report records both limits', async () => {
  const short = await command(['solid'], '', { totalTimeoutS: 0.5 });
  assert.equal(short.report.examples[0].outcome, 'TIMEOUT');
  assert.equal(short.report.examples[0].limit, 'total');
  const raised = await command(['solid'], '', { totalTimeoutS: 30, timeoutS: 20 });
  assert.ok(raised.ok);
  assert.equal(raised.report.examples[0].outcome, 'PASS');
  assert.equal(raised.report.totalTimeoutSeconds, 30);
  assert.equal(raised.report.idleTimeoutSeconds, 20);
});

test('Updating expectations through the command: passes removed, failures and tolerances written', async () => {
  const { ok, written } = await command(['solid', 'console-error', 'seeded'], 'solid FAIL # fixed since\n', { update: true });
  assert.ok(ok);
  const entries = parseThreejsExpectations(written);
  assert.equal(entries.has('threejs solid'), false);
  assert.equal(entries.get('threejs console-error').reason, 'THREE.WebGLProgram: Shader Error 0 - VALIDATE_STATUS false');
  assert.match(entries.get('threejs seeded').reason, /no reference screenshot/);
});

test('Default parallelism: the command uses the conformance default and records it', async () => {
  const { report } = await command(['solid'], '', { jobs: undefined });
  assert.equal(report.jobs, defaultJobs());
  await assert.rejects(threejsMain(['--jobs', '0']), /--jobs must be a positive integer/);
  await assert.rejects(threejsMain(['--total-timeout', '0']), /--total-timeout must be a positive number/);
});
