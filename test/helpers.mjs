// Shared helpers for the context test suites.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { native } from '../dist/native.js';

/** Number of live native contexts in this thread's environment. */
export function liveContexts() {
  return native.liveContexts();
}

/** Number of live WebGL objects across this thread's contexts. */
export function liveObjects() {
  return native.liveObjects();
}

/** Reads the whole drawing buffer as RGBA/UNSIGNED_BYTE. */
export function readAll(gl) {
  const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
  gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}

/** Whether every pixel of `pixels` equals `rgba`. */
export function allPixels(pixels, rgba) {
  for (let i = 0; i < pixels.length; i += 4) {
    if (rgba.some((value, c) => pixels[i + c] !== value)) return false;
  }
  return true;
}

/**
 * Wraps the named native functions to count their calls; returns the counts
 * and a function restoring the originals.
 */
export function countNativeCalls(names) {
  const counts = Object.fromEntries(names.map((name) => [name, 0]));
  const originals = names.map((name) => native[name]);
  for (const name of names) {
    const original = native[name];
    native[name] = (...args) => {
      counts[name] += 1;
      return original(...args);
    };
  }
  return {
    counts,
    restore() {
      names.forEach((name, i) => {
        native[name] = originals[i];
      });
    },
  };
}

/** Runs `fn` with `OXGL_BACKEND` set to `value` (or unset), then restores it. */
export function withBackendEnv(value, fn) {
  const saved = process.env.OXGL_BACKEND;
  if (value === undefined) delete process.env.OXGL_BACKEND;
  else process.env.OXGL_BACKEND = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.OXGL_BACKEND;
    else process.env.OXGL_BACKEND = saved;
  }
}

/**
 * Why a forced-GPU test cannot run here, or `undefined` if it can: the
 * environment forces another backend, or no GPU backend is usable. It probes
 * in a child process: on Linux, a GPU context would hold the process's one
 * Vulkan device and refuse a later 'software' context.
 */
export async function gpuSkipReason() {
  const forced = process.env.OXGL_BACKEND;
  if (forced !== undefined && forced !== '' && forced !== 'gpu') {
    return `OXGL_BACKEND=${forced} forces another backend`;
  }
  const script = `
    import { createContext } from '@oxgl-js/oxgl';
    try {
      createContext({ width: 1, height: 1, backend: 'gpu' }).destroy();
      console.log(JSON.stringify({}));
    } catch (error) {
      console.log(JSON.stringify({ code: error.code, message: error.message }));
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const { code, message } = JSON.parse(result.stdout.trim().split('\n').at(-1));
  if (code === undefined) return undefined;
  if (code === 'OXGL_GPU_UNAVAILABLE') return `no usable GPU: ${message}`;
  throw new Error(`the GPU probe failed: ${code}: ${message}`);
}

/** Whether 'gpu' and 'software' contexts exclude each other in one process: on Linux, where both are Vulkan. */
export const oneVulkanDevice = process.platform === 'linux';
