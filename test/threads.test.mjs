// Contexts on several threads. These tests have a file, and so a process, of
// their own: on Linux, a process that has used 'software' can't use the GPU
// (backend-selection.test.mjs), so they would run on SwiftShader, or fail under
// OXGL_BACKEND=gpu.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';

import { createContext } from '@oxgl-js/oxgl';

import { allPixels, readAll } from './helpers.mjs';

// Contexts on two threads must share a backend: on the OpenGL ES backend, a
// second thread used to fail, and 'auto' then hid that with SwiftShader.
test('a worker uses the same backend as a live context on the main thread', { timeout: 60_000 }, async () => {
  const gl = createContext({ width: 1, height: 1 });
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
  gl.clearColor(0, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  assert.equal(gl.getError(), gl.NO_ERROR);
  const worker = new Worker(
    `
      const { parentPort } = require('node:worker_threads');
      import('@oxgl-js/oxgl').then(({ createContext }) => {
        const gl = createContext({ width: 1, height: 1 });
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
        gl.clearColor(0, 0, 1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const pixel = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        parentPort.postMessage({ renderer, pixel: [...pixel] });
        gl.destroy();
      });
    `,
    { eval: true },
  );
  // Listen for both at once: a message and an exit can arrive in one step.
  const [[message]] = await Promise.all([once(worker, 'message'), once(worker, 'exit')]);
  assert.deepEqual(message, { renderer, pixel: [0, 0, 255, 255] });
  gl.clear(gl.COLOR_BUFFER_BIT);
  assert.ok(allPixels(readAll(gl), [0, 255, 0, 255]), 'the main thread still renders');
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

// ANGLE's Metal backend shares a command queue across a display's contexts, so
// threads on one display read stale pixels, and sometimes crash.
test('threads drawing at once read their own pixels', { timeout: 60_000 }, async () => {
  const body = `
    const gl = createContext({ width: 4, height: 4, attributes: { antialias: false } });
    const pixel = new Uint8Array(4);
    let wrong = 0;
    for (let i = 0; i < 500; i++) {
      const value = (i % 200) + 20;
      gl.clearColor(value / 255, 0, 1 - value / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if (Math.abs(pixel[0] - value) > 1 || pixel[3] !== 255) wrong++;
    }
    const lost = gl.isContextLost();
    gl.destroy();
  `;
  const worker = `
    const { parentPort } = require('node:worker_threads');
    import('@oxgl-js/oxgl').then(({ createContext }) => {
      ${body}
      parentPort.postMessage({ wrong, lost });
    });
  `;
  const workers = [0, 1, 2].map(() => new Worker(worker, { eval: true }));
  // Listen for both at once: a message and an exit can arrive in one step.
  const results = await Promise.all(workers.map((w) => Promise.all([once(w, 'message'), once(w, 'exit')])));
  for (const [[result]] of results) assert.deepEqual(result, { wrong: 0, lost: false });
});
