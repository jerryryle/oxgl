// Shared helpers for the soak tests: soak.test.mjs and soak-gpu.test.mjs.
//
// OXGL_SOAK_ITERATIONS overrides the measured cycle count (default 1,000).
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { createContext } from '@oxgl-js/oxgl';

// Equivalent to running with --expose-gc, without depending on how the test
// runner passes flags to its subprocesses.
setFlagsFromString('--expose-gc');
export const gc = runInNewContext('gc');

export const ITERATIONS = Number(process.env.OXGL_SOAK_ITERATIONS ?? 1000);
const WARM_UP = 50;
const SIZE = 256;
export const THRESHOLD = 32 * 1024 * 1024;

export const turn = () => new Promise((resolve) => setImmediate(resolve));

export function rssAfterGc() {
  gc();
  gc();
  return process.memoryUsage.rss();
}

const pixel = new Uint8Array(4);

/** Creates a context and renders into it, so its buffers are resident (an
 * untouched buffer may never be backed by physical memory, hiding a leak). */
export function used(backend, webgl2 = false) {
  const gl = createContext({ width: SIZE, height: SIZE, backend, webgl2 });
  gl.clearColor(0, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  return gl;
}

function cycle(backend, webgl2) {
  used(backend, webgl2).destroy();
}

/** The process's thread count on Linux (a driver may start threads per context), else undefined. */
function threads() {
  try {
    return readdirSync('/proc/self/task').length;
  } catch {
    return undefined;
  }
}

export function soak(t, backend, webgl2 = false) {
  for (let i = 0; i < WARM_UP; i += 1) cycle(backend, webgl2);
  const baseline = rssAfterGc();
  const baseThreads = threads();
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i += 1) cycle(backend, webgl2);
  const perCycle = (performance.now() - start) / ITERATIONS;
  const growth = rssAfterGc() - baseline;
  t.diagnostic(`${backend}: ${ITERATIONS} cycles, ${perCycle.toFixed(3)} ms/cycle, RSS growth ${(growth / 1048576).toFixed(1)} MiB`);
  assert.ok(growth <= THRESHOLD, `RSS grew by ${(growth / 1048576).toFixed(1)} MiB (limit 32 MiB)`);
  if (baseThreads !== undefined) {
    // A few threads may come and go (libuv, the GC); per-context threads would add ITERATIONS.
    assert.ok(threads() - baseThreads <= 8, `threads grew from ${baseThreads} to ${threads()}`);
  }
}
