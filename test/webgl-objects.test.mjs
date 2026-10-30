// webgl-objects spec scenarios: interfaces, ownership, deletion, lost
// contexts and garbage collection.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { createContext, WebGLBuffer, WebGLObject, WebGLProgram, WebGLShader } from 'oxgl';

import { color, program, quad } from './gl-helpers.mjs';
import { allPixels, liveObjects, readAll } from './helpers.mjs';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc');
const turn = () => new Promise((resolve) => setImmediate(resolve));

test('object interfaces are not constructible', () => {
  for (const Class of [WebGLObject, WebGLBuffer, WebGLShader, WebGLProgram]) {
    assert.throws(() => new Class(), TypeError, Class.name);
  }
});

test('inheritance and label', () => {
  const gl = createContext({ width: 1, height: 1 });
  const buffer = gl.createBuffer();
  assert.ok(buffer instanceof WebGLBuffer);
  assert.ok(buffer instanceof WebGLObject);
  assert.equal(buffer.label, '');
  buffer.label = 42;
  assert.equal(buffer.label, '42');
  gl.destroy();
});

test('buffer from another context', () => {
  const a = createContext({ width: 1, height: 1 });
  const b = createContext({ width: 1, height: 1 });
  const buffer = a.createBuffer();
  b.bindBuffer(b.ARRAY_BUFFER, buffer);
  assert.equal(b.getError(), b.INVALID_OPERATION);
  assert.equal(b.getParameter(b.ARRAY_BUFFER_BINDING), null);
  assert.equal(b.isBuffer(buffer), false);
  a.destroy();
  b.destroy();
});

test('wrong object types throw TypeError', () => {
  const gl = createContext({ width: 1, height: 1 });
  assert.throws(() => gl.bindBuffer(gl.ARRAY_BUFFER, gl.createShader(gl.VERTEX_SHADER)), TypeError);
  assert.throws(() => gl.compileShader(null), TypeError);
  assert.throws(() => gl.useProgram({}), TypeError);
  gl.destroy();
});

test('deleted buffer', () => {
  const gl = createContext({ width: 1, height: 1 });
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.deleteBuffer(buffer);
  assert.equal(gl.isBuffer(buffer), false);
  assert.equal(gl.getParameter(gl.ARRAY_BUFFER_BINDING), null);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.deleteBuffer(buffer);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('deleted program still in use', () => {
  const gl = createContext({ width: 4, height: 4 });
  const p = program(gl);
  gl.useProgram(p);
  quad(gl, p);
  color(gl, p, [0, 0, 1, 1]);
  gl.deleteProgram(p);
  // GL deletes it once it is no longer current (deqp lifetime.delete_used).
  assert.equal(gl.isProgram(p), true);
  assert.equal(gl.getProgramParameter(p, gl.DELETE_STATUS), true);
  assert.equal(gl.getParameter(gl.CURRENT_PROGRAM), p);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  assert.ok(allPixels(readAll(gl), [0, 0, 255, 255]));
  gl.useProgram(null);
  assert.equal(gl.isProgram(p), false);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('objects of a lost context', () => {
  const gl = createContext({ width: 1, height: 1 });
  const old = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, old);
  gl.destroy();
  const created = gl.createBuffer();
  assert.ok(created instanceof WebGLBuffer);
  assert.equal(gl.isBuffer(created), false);
  assert.equal(gl.isBuffer(old), false);
  assert.ok(gl.createShader(gl.VERTEX_SHADER) instanceof WebGLShader);
  assert.equal(gl.getError(), gl.CONTEXT_LOST_WEBGL);
  assert.equal(gl.getError(), gl.NO_ERROR);
});

test('dropped buffers are released after collection', async () => {
  const gl = createContext({ width: 1, height: 1 });
  const before = liveObjects();
  const data = new Uint8Array(1024);
  for (let i = 0; i < 10_000; i++) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  for (let i = 0; i < 10 && liveObjects() > before; i++) {
    gc();
    await turn();
    gl.getError(); // any native call drains the deletion queue
  }
  assert.equal(liveObjects(), before);
  gl.destroy();
});

test('a bound buffer survives collection', async () => {
  const gl = createContext({ width: 4, height: 4 });
  const p = program(gl);
  gl.useProgram(p);
  quad(gl, p); // the buffer stays bound to ARRAY_BUFFER and attribute p
  color(gl, p, [1, 0, 0, 1]);
  gc();
  await turn();
  gc();
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  assert.ok(allPixels(readAll(gl), [255, 0, 0, 255]));
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});
