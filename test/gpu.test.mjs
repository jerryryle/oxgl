// GPU variants of clear-then-readPixels. They skip, with the reason, when
// OXGL_BACKEND forces another backend or no GPU backend is usable.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createContext } from 'oxgl';

import { allPixels, gpuSkipReason, readAll } from './helpers.mjs';

const skip = await gpuSkipReason();

for (const webgl2 of [false, true]) {
  test(`GPU clear then readPixels (WebGL ${webgl2 ? 2 : 1})`, { skip }, () => {
    const gl = createContext({ width: 64, height: 32, backend: 'gpu', webgl2 });
    try {
      assert.ok(readAll(gl).every((byte) => byte === 0), 'initial contents are zero');
      gl.clearColor(0, 1, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      assert.ok(allPixels(readAll(gl), [0, 255, 0, 255]));
      assert.equal(gl.getError(), gl.NO_ERROR);
    } finally {
      gl.destroy();
    }
  });
}
