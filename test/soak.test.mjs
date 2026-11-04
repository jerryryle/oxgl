// Memory soak tests (context-creation spec: "No resource growth across context
// lifecycles" and "Garbage-collected contexts release resources"). The GPU
// soak tests are in soak-gpu.test.mjs: on Linux a process uses one Vulkan
// device, the GPU or SwiftShader.
//
// OXGL_SOAK_ITERATIONS overrides the measured cycle count (default 1,000).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { liveContexts } from './helpers.mjs';
import { gc, ITERATIONS, rssAfterGc, soak, THRESHOLD, turn, used } from './soak-helpers.mjs';

test('software soak test', (t) => {
  soak(t, 'software');
});

/** Forces GC and yields until `done()` holds, failing after 10 s. */
async function collectUntil(done, what) {
  const deadline = Date.now() + 10_000;
  while (!done()) {
    assert.ok(Date.now() < deadline, `${what} within 10 s`);
    gc();
    await turn();
  }
}

/**
 * Creates `count` contexts, each dropped without destroy(). Every 100 it
 * forces GC until those are released natively, so at most 100 are ever alive
 * and the allocators' high-water mark does not depend on GC timing. Then it
 * waits until `registry`'s callback has seen every one collected and until
 * every one is released natively (oxgl releases from its own registry, whose
 * callbacks may run after this one's), plus 10 event-loop turns.
 */
async function dropContexts(count) {
  const baseline = liveContexts();
  let collected = 0;
  const registry = new FinalizationRegistry(() => {
    collected += 1;
  });
  for (let i = 0; i < count; i += 1) {
    registry.register(used('software'), undefined);
    if (i % 100 === 99) {
      await collectUntil(() => liveContexts() === baseline, 'contexts were not released');
    }
  }
  // The predicate references `registry`: an unreachable registry can itself
  // be collected, and its pending callbacks then never run.
  await collectUntil(() => registry !== null && collected === count, 'not every context was collected');
  await collectUntil(() => liveContexts() === baseline, 'contexts were not released');
  for (let i = 0; i < 10; i += 1) await turn();
}

/** Runs `pass` `passes` times; returns the RSS growth of each, after GC. */
async function rssGrowths(passes, pass) {
  const growths = [];
  let before = rssAfterGc();
  for (let i = 0; i < passes; i += 1) {
    await pass();
    const after = rssAfterGc();
    growths.push(after - before);
    before = after;
  }
  return growths;
}

const mib = (bytes) => `${(bytes / 1048576).toFixed(1)} MiB`;

test('dropped contexts are reclaimed', async (t) => {
  // Up to ~100 contexts are alive between collections, so the allocators'
  // high-water mark is far above the destroy() soak's. The warm-up runs the
  // same pattern twice before measuring: glibc raises its mmap threshold
  // after the first frees, so only from the second pass on do the buffers
  // come from a heap that keeps its high-water mark.
  //
  // RSS still moves in allocator steps (up to ~125 MiB on Linux arm64, and
  // ~150 MiB on Linux x64) and trims, in whichever pass they land, so several
  // passes in a row can swing up: on Linux x64 three did (69, 72, 56 MiB). A
  // leak grows every pass, so the gate is the smallest growth of five.
  const baselineContexts = liveContexts();
  await dropContexts(ITERATIONS);
  await dropContexts(ITERATIONS);
  const growths = await rssGrowths(5, async () => {
    await dropContexts(ITERATIONS);
    assert.equal(liveContexts(), baselineContexts, 'every collected context was released');
  });
  const least = Math.min(...growths);
  t.diagnostic(`GC-only: RSS growth per pass ${growths.map(mib).join(', ')}; least ${mib(least)}`);
  assert.ok(least <= THRESHOLD, `least RSS growth per pass ${mib(least)} (limit 32 MiB)`);
});
