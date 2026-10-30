// buffers spec scenarios.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createContext } from 'oxgl';

test('bind and query', () => {
  const gl = createContext({ width: 1, height: 1 });
  const buffer = gl.createBuffer();
  assert.equal(gl.isBuffer(buffer), false, 'not a buffer object until bound');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  assert.equal(gl.getParameter(gl.ARRAY_BUFFER_BINDING), buffer);
  assert.equal(gl.isBuffer(buffer), true);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  assert.equal(gl.getParameter(gl.ARRAY_BUFFER_BINDING), null);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('WebGL 2 target on WebGL 1', () => {
  const gl = createContext({ width: 1, height: 1 });
  gl.bindBuffer(0x8f36 /* COPY_READ_BUFFER */, gl.createBuffer());
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  gl.destroy();
});

test('element buffer rebound as array buffer', () => {
  for (const webgl2 of [false, true]) {
    const gl = createContext({ width: 1, height: 1, webgl2 });
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    assert.equal(gl.getError(), gl.INVALID_OPERATION);
    assert.equal(gl.getParameter(gl.ARRAY_BUFFER_BINDING), null);
    const other = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, other);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, other);
    assert.equal(gl.getError(), gl.INVALID_OPERATION);
    if (webgl2) {
      gl.bindBuffer(gl.COPY_READ_BUFFER, buffer);
      assert.equal(gl.getError(), gl.NO_ERROR, 'element buffers may be bound to copy targets');
    }
    gl.destroy();
  }
});

test('data round trip (WebGL 2)', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([1, 2, 3, 4]), gl.STATIC_DRAW);
  gl.bufferSubData(gl.ARRAY_BUFFER, 4, new Float32Array([9]));
  const out = new Float32Array(4);
  gl.getBufferSubData(gl.ARRAY_BUFFER, 0, out);
  assert.deepEqual([...out], [1, 9, 3, 4]);
  const partial = new Float32Array(4);
  gl.getBufferSubData(gl.ARRAY_BUFFER, 8, partial, 1, 2);
  assert.deepEqual([...partial], [0, 3, 4, 0]);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('size form is zero-filled', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, 16, gl.STATIC_DRAW);
  const out = new Uint8Array(16).fill(7);
  gl.getBufferSubData(gl.ARRAY_BUFFER, 0, out);
  assert.ok(out.every((b) => b === 0));
  gl.destroy();
});

test('srcOffset and length (WebGL 2)', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(4), gl.STATIC_DRAW, 5);
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  gl.bufferData(gl.ARRAY_BUFFER, new Uint16Array([1, 2, 3, 4]), gl.STATIC_DRAW, 1, 2);
  assert.equal(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE), 4);
  const out = new Uint16Array(2);
  gl.getBufferSubData(gl.ARRAY_BUFFER, 0, out);
  assert.deepEqual([...out], [2, 3]);
  gl.destroy();
});

test('shared memory and bare buffers', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  const shared = new Uint8Array(new SharedArrayBuffer(24)).map((_, i) => i);
  gl.bufferData(gl.ARRAY_BUFFER, shared, gl.STATIC_DRAW);
  const out = new Uint8Array(new SharedArrayBuffer(24));
  gl.getBufferSubData(gl.ARRAY_BUFFER, 0, out);
  assert.deepEqual([...out], [...shared]);
  gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array([5, 6]).buffer, gl.STATIC_DRAW);
  assert.equal(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE), 2);
  gl.destroy();
});

test('null data and negative sizes', () => {
  const gl = createContext({ width: 1, height: 1 });
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, null, gl.STATIC_DRAW);
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  gl.bufferData(gl.ARRAY_BUFFER, -1, gl.STATIC_DRAW);
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  gl.bufferSubData(gl.ARRAY_BUFFER, -1, new Uint8Array(1));
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  assert.throws(() => gl.bufferSubData(gl.ARRAY_BUFFER, 0, null), TypeError);
  gl.destroy();
});

test('buffer size and usage', () => {
  const gl = createContext({ width: 1, height: 1 });
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, 12, gl.DYNAMIC_DRAW);
  assert.equal(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE), 12);
  assert.equal(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_USAGE), gl.DYNAMIC_DRAW);
  assert.equal(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_ACCESS_FLAGS ?? 0x911f), null);
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  gl.destroy();
});

test('copy between buffers', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  gl.bindBuffer(gl.COPY_READ_BUFFER, gl.createBuffer());
  gl.bufferData(gl.COPY_READ_BUFFER, new Uint8Array([1, 2, 3, 4]), gl.STATIC_DRAW);
  gl.bindBuffer(gl.COPY_WRITE_BUFFER, gl.createBuffer());
  gl.bufferData(gl.COPY_WRITE_BUFFER, 4, gl.STATIC_DRAW);
  gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, 4);
  const out = new Uint8Array(4);
  gl.getBufferSubData(gl.COPY_WRITE_BUFFER, 0, out);
  assert.deepEqual([...out], [1, 2, 3, 4]);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});
