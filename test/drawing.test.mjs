// drawing spec scenarios: clearColor and clear.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createContext, WebGL2RenderingContext, WebGLRenderingContext } from 'oxgl';

import { color as setColor, program as linkProgram, quad as fullQuad } from './gl-helpers.mjs';
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

test('flush and finish', (t) => {
  const gl = context(t);
  gl.clearColor(0, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  assert.equal(gl.flush(), undefined);
  assert.equal(gl.finish(), undefined);
  assert.equal(gl.getError(), gl.NO_ERROR);
  assert.ok(allPixels(readAll(gl), [0, 255, 0, 255]));
});

// --- Vertex attributes and draw calls (core-rendering) ----------------------

test('vertex attribute pointer state', () => {
  const gl = createContext({ width: 1, height: 1 });
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 12, 4);
  assert.equal(gl.getVertexAttrib(1, gl.VERTEX_ATTRIB_ARRAY_SIZE), 3);
  assert.equal(gl.getVertexAttrib(1, gl.VERTEX_ATTRIB_ARRAY_STRIDE), 12);
  assert.equal(gl.getVertexAttrib(1, gl.VERTEX_ATTRIB_ARRAY_TYPE), gl.FLOAT);
  assert.equal(gl.getVertexAttrib(1, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED), false);
  assert.equal(gl.getVertexAttrib(1, gl.VERTEX_ATTRIB_ARRAY_ENABLED), false);
  assert.equal(gl.getVertexAttrib(1, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING), buffer);
  assert.equal(gl.getVertexAttribOffset(1, gl.VERTEX_ATTRIB_ARRAY_POINTER), 4);
  gl.deleteBuffer(buffer);
  assert.equal(gl.getVertexAttrib(1, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING), null);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('constant attributes', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  gl.vertexAttrib2f(0, 1, 2);
  assert.deepEqual(gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB), new Float32Array([1, 2, 0, 1]));
  gl.vertexAttribI4ui(0, 1, 2, 3, 4);
  assert.deepEqual(gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB), new Uint32Array([1, 2, 3, 4]));
  gl.vertexAttribI4iv(0, [-1, 2, 3, 4]);
  assert.deepEqual(gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB), new Int32Array([-1, 2, 3, 4]));
  gl.vertexAttrib4fv(0, [1, 2, 3]);
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  gl.destroy();
});

test('attribute index out of range', () => {
  const gl = createContext({ width: 1, height: 1 });
  gl.enableVertexAttribArray(gl.getParameter(gl.MAX_VERTEX_ATTRIBS));
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  assert.equal(gl.getVertexAttrib(gl.getParameter(gl.MAX_VERTEX_ATTRIBS), gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING), null);
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  gl.destroy();
});

test('pointer with no buffer and an offset', () => {
  const gl = createContext({ width: 1, height: 1 });
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 8);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.destroy();
});

test('triangle and indexed draw', () => {
  for (const webgl2 of [false, true]) {
    const gl = createContext({ width: 8, height: 8, webgl2 });
    const p = linkProgram(gl);
    gl.useProgram(p);
    fullQuad(gl, p);
    setColor(gl, p, [1, 0, 0, 1]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    assert.ok(allPixels(readAll(gl), [255, 0, 0, 255]));
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 3, 4, 5]), gl.STATIC_DRAW);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    assert.ok(allPixels(readAll(gl), [255, 0, 0, 255]));
    if (webgl2) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawRangeElements(gl.TRIANGLES, 0, 5, 6, gl.UNSIGNED_SHORT, 0);
      assert.ok(allPixels(readAll(gl), [255, 0, 0, 255]));
    }
    assert.equal(gl.getError(), gl.NO_ERROR);
    gl.destroy();
  }
});

test('out-of-range and misaligned draws', () => {
  const gl = createContext({ width: 4, height: 4 });
  const p = linkProgram(gl);
  gl.useProgram(p);
  fullQuad(gl, p);
  // WebGL 1.0 §6.6 allows either an error or robust access that reads no
  // memory outside the buffer.
  gl.drawArrays(gl.TRIANGLES, 0, 3000);
  assert.ok([gl.NO_ERROR, gl.INVALID_OPERATION].includes(gl.getError()));
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 3]), gl.STATIC_DRAW);
  gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 1);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, -2);
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  gl.destroy();
});
