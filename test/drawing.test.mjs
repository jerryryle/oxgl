// drawing spec scenarios: clearColor and clear.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createContext, WebGL2RenderingContext, WebGLRenderingContext } from 'oxgl';

import { allPixels, readAll } from './helpers.mjs';

function context(t, options = {}) {
  const gl = createContext({ width: 4, height: 4, ...options });
  t.after(() => gl.destroy());
  return gl;
}

test('clear color applied', (t) => {
  const gl = context(t);
  gl.clearColor(1, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  assert.ok(allPixels(readAll(gl), [255, 0, 0, 255]));
});

test('out-of-range values are clamped for the default framebuffer', (t) => {
  const gl = context(t);
  gl.clearColor(2, -1, 0.5, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const [r, g, b, a] = readAll(gl);
  assert.deepEqual([r, g, a], [255, 0, 255]);
  assert.ok(b === 127 || b === 128, String(b));
});

test('WebIDL conversion', (t) => {
  const converted = context(t);
  const reference = context(t);
  converted.clearColor('1', null, undefined, true);
  reference.clearColor(1, 0, NaN, 1);
  converted.clear(converted.COLOR_BUFFER_BIT);
  reference.clear(reference.COLOR_BUFFER_BIT);
  assert.deepEqual(readAll(converted), readAll(reference));
  assert.throws(() => converted.clearColor(1n, 0, 0, 1), TypeError);
});

test('too few arguments', (t) => {
  const gl = context(t);
  gl.clearColor(0, 0, 1, 1);
  assert.throws(() => gl.clearColor(1, 0, 0), TypeError);
  assert.throws(() => gl.clear(), TypeError);
  gl.clear(gl.COLOR_BUFFER_BIT);
  assert.ok(allPixels(readAll(gl), [0, 0, 255, 255]), 'clear color unchanged');
});

test('color clear fills every pixel', (t) => {
  const gl = context(t, { width: 33, height: 17 });
  gl.clearColor(0.2, 0.4, 0.6, 0.8);
  gl.clear(gl.COLOR_BUFFER_BIT);
  // Float-to-unorm conversion may round or truncate (OpenGL ES 2.0 §2.1.2).
  const expected = [0.2, 0.4, 0.6, 0.8].map((c) => c * 255);
  const pixels = readAll(gl);
  for (let i = 0; i < pixels.length; i += 1) {
    assert.ok(Math.abs(pixels[i] - expected[i % 4]) <= 1, `byte ${i}: ${pixels[i]}`);
  }
});

test('invalid mask bits', (t) => {
  const gl = context(t);
  gl.clearColor(1, 1, 1, 1);
  gl.clear(0x1);
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  assert.ok(allPixels(readAll(gl), [0, 0, 0, 0]), 'drawing buffer unchanged');
});

test('combined mask on a buffer without stencil', (t) => {
  const gl = context(t);
  gl.clearColor(0, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  assert.ok(allPixels(readAll(gl), [0, 255, 0, 255]));
  assert.equal(gl.getError(), gl.NO_ERROR);
});

test('drawing works in WebGL 2', (t) => {
  const gl = context(t, { webgl2: true });
  gl.clearColor(0, 0, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  assert.ok(allPixels(readAll(gl), [0, 0, 255, 255]));
});

test('constant values', (t) => {
  const gl = context(t);
  for (const holder of [gl, WebGLRenderingContext, WebGL2RenderingContext]) {
    assert.equal(holder.COLOR_BUFFER_BIT, 0x00004000);
    assert.equal(holder.DEPTH_BUFFER_BIT, 0x00000100);
    assert.equal(holder.STENCIL_BUFFER_BIT, 0x00000400);
  }
});
