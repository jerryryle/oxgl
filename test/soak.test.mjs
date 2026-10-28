// Memory soak tests (context-creation spec: "No resource growth across context
// lifecycles" and "Garbage-collected contexts release resources").
//
// OXGL_SOAK_ITERATIONS overrides the measured cycle count (default 1,000).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { createContext } from 'oxgl';

import { gpuSkipReason, liveContexts } from './helpers.mjs';

// Equivalent to running with --expose-gc, without depending on how the test
// runner passes flags to its subprocesses.
setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc');

const ITERATIONS = Number(process.env.OXGL_SOAK_ITERATIONS ?? 1000);
const WARM_UP = 50;
const SIZE = 256;
const THRESHOLD = 32 * 1024 * 1024;

const turn = () => new Promise((resolve) => setImmediate(resolve));

function rssAfterGc() {
  gc();
  gc();
  return process.memoryUsage.rss();
}

const pixel = new Uint8Array(4);

/** Creates a context and renders into it, so its buffers are resident (an
 * untouched buffer may never be backed by physical memory, hiding a leak). */
function used(backend) {
  const gl = createContext({ width: SIZE, height: SIZE, backend });
  gl.clearColor(0, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  return gl;
}

function cycle(backend) {
  used(backend).destroy();
}

function soak(t, backend) {
  for (let i = 0; i < WARM_UP; i += 1) cycle(backend);
  const baseline = rssAfterGc();
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i += 1) cycle(backend);
  const perCycle = (performance.now() - start) / ITERATIONS;
  const growth = rssAfterGc() - baseline;
  t.diagnostic(`${backend}: ${ITERATIONS} cycles, ${perCycle.toFixed(3)} ms/cycle, RSS growth ${(growth / 1048576).toFixed(1)} MiB`);
  assert.ok(growth <= THRESHOLD, `RSS grew by ${(growth / 1048576).toFixed(1)} MiB (limit 32 MiB)`);
}

test('software soak test', (t) => {
  soak(t, 'software');
});

test('GPU soak test', { skip: await gpuSkipReason() }, (t) => {
  soak(t, 'gpu');
});

/**
 * Creates `count` contexts, each dropped without destroy(), forcing GC (and
 * yielding so finalizers can run) every 100, then waits until `registry`'s
 * callback has seen every one collected (failing after 10 s), plus 10 turns.
 */
async function dropContexts(count) {
  let collected = 0;
  const registry = new FinalizationRegistry(() => {
    collected += 1;
  });
  for (let i = 0; i < count; i += 1) {
    registry.register(used('software'), undefined);
    if (i % 100 === 99) {
      gc();
      await turn();
    }
  }
  const deadline = Date.now() + 10_000;
  while (collected < count) {
    assert.ok(Date.now() < deadline, `only ${collected} of ${count} contexts were collected within 10 s`);
    gc();
    await turn();
  }
  for (let i = 0; i < 10; i += 1) await turn();
}

test('dropped contexts are reclaimed', async (t) => {
  // Up to ~100 contexts are alive between collections, so the allocators'
  // high-water mark is far above the destroy() soak's. The warm-up runs the
  // same pattern once, so the measured pass shows growth, not that mark.
  const baselineContexts = liveContexts();
  await dropContexts(ITERATIONS);
  const baseline = rssAfterGc();
  await dropContexts(ITERATIONS);
  const growth = rssAfterGc() - baseline;
  t.diagnostic(`GC-only: RSS growth ${(growth / 1048576).toFixed(1)} MiB`);
  assert.equal(liveContexts(), baselineContexts, 'every collected context was released');
  assert.ok(growth <= THRESHOLD, `RSS grew by ${(growth / 1048576).toFixed(1)} MiB (limit 32 MiB)`);
});
