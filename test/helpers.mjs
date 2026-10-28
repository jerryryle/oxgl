// Shared helpers for the context test suites.
import { native } from '../dist/native.js';

/** Number of live native contexts in this thread's environment. */
export function liveContexts() {
  return native.liveContexts();
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
 * environment forces another backend, or no GPU backend is usable.
 */
export async function gpuSkipReason() {
  const forced = process.env.OXGL_BACKEND;
  if (forced !== undefined && forced !== '' && forced !== 'gpu') {
    return `OXGL_BACKEND=${forced} forces another backend`;
  }
  const { createContext } = await import('oxgl');
  try {
    createContext({ width: 1, height: 1, backend: 'gpu' }).destroy();
    return undefined;
  } catch (error) {
    if (error.code === 'OXGL_GPU_UNAVAILABLE') return `no usable GPU: ${error.message}`;
    throw error;
  }
}
