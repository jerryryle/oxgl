// pixel-readback spec scenarios.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';

import { createContext } from 'oxgl';

import { allPixels } from './helpers.mjs';

function context(t, options = {}) {
  const gl = createContext({ width: 4, height: 4, ...options });
  t.after(() => gl.destroy());
  return gl;
}

function filled(length, value) {
  return new Uint8Array(length).fill(value);
}

test('read after clear', (t) => {
  const gl = context(t, { width: 5, height: 3 });
  gl.clearColor(0, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const pixels = new Uint8Array(5 * 3 * 4);
  gl.readPixels(0, 0, 5, 3, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  assert.ok(allPixels(pixels, [0, 255, 0, 255]));
  assert.equal(gl.getError(), gl.NO_ERROR);
});

test('rows are written bottom to top', (t) => {
  const gl = context(t, { width: 1, height: 2 });
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const pixels = filled(8, 7);
  gl.readPixels(0, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  assert.deepEqual([...pixels], [255, 255, 255, 255, 7, 7, 7, 7]);
});

test('exact required size', (t) => {
  const gl = context(t);
  const exact = filled(24, 9);
  gl.readPixels(0, 0, 3, 2, gl.RGBA, gl.UNSIGNED_BYTE, exact);
  assert.equal(gl.getError(), gl.NO_ERROR);
  assert.ok(exact.every((byte) => byte === 0));
  const short = filled(23, 9);
  gl.readPixels(0, 0, 3, 2, gl.RGBA, gl.UNSIGNED_BYTE, short);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  assert.ok(short.every((byte) => byte === 9));
});

test('invalid enum', (t) => {
  const gl = context(t);
  const pixels = filled(4, 9);
  gl.readPixels(0, 0, 1, 1, 0x1234, gl.UNSIGNED_BYTE, pixels);
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  assert.ok(pixels.every((byte) => byte === 9));
});

test('wrong view type', (t) => {
  const gl = context(t);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Float32Array(4));
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new DataView(new ArrayBuffer(4)));
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8ClampedArray(4));
  assert.equal(gl.getError(), gl.NO_ERROR);
});

test('destination too small', (t) => {
  const gl = context(t);
  const pixels = filled(15, 9);
  gl.readPixels(0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  assert.ok(pixels.every((byte) => byte === 9));
});

test('view offset is honored', (t) => {
  const gl = context(t);
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const buffer = new ArrayBuffer(12);
  new Uint8Array(buffer).fill(7);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(buffer, 4, 4));
  assert.deepEqual([...new Uint8Array(buffer)], [7, 7, 7, 7, 255, 255, 255, 255, 7, 7, 7, 7]);
});

test('unaligned views of every length', (t) => {
  const gl = context(t);
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  // Offsets and lengths exercise the head, word, and tail of the copies.
  for (let offset = 0; offset < 9; offset += 1) {
    for (const width of [1, 2, 3, 4]) {
      const buffer = new ArrayBuffer(offset + width * 4 + 8);
      new Uint8Array(buffer).fill(7);
      gl.readPixels(0, 0, width, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(buffer, offset, width * 4));
      const bytes = new Uint8Array(buffer);
      bytes.forEach((byte, i) => {
        const inside = i >= offset && i < offset + width * 4;
        assert.equal(byte, inside ? 255 : 7, `offset ${offset}, width ${width}, byte ${i}`);
      });
    }
  }
  assert.equal(gl.getError(), gl.NO_ERROR);
});

test('null destination in WebGL 1', (t) => {
  const gl = context(t);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, null);
  assert.equal(gl.getError(), gl.INVALID_VALUE);
});

test('non-view destination', (t) => {
  const gl = context(t);
  assert.throws(() => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, [0, 0, 0, 0]), TypeError);
  assert.throws(() => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new ArrayBuffer(4)), TypeError);
  assert.throws(() => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE), TypeError);
  assert.equal(gl.getError(), gl.NO_ERROR);
});

test('negative width', (t) => {
  const gl = context(t);
  const pixels = filled(4, 9);
  gl.readPixels(0, 0, -1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  assert.ok(pixels.every((byte) => byte === 9));
});

test('partially outside region', (t) => {
  const gl = context(t);
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const pixels = filled(64, 7);
  gl.readPixels(-2, -2, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  assert.equal(gl.getError(), gl.NO_ERROR);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const expected = x >= 2 && y >= 2 ? 255 : 7;
      const pixel = pixels.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4);
      assert.deepEqual([...pixel], [expected, expected, expected, expected], `pixel (${x}, ${y})`);
    }
  }
});

test('shared destination', async (t) => {
  const gl = context(t);
  gl.clearColor(0, 0.5, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const unshared = new Uint8Array(64);
  gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, unshared);

  // [control (4 bytes)][pixels (64 bytes)][worker region (4096 bytes)]
  const buffer = new SharedArrayBuffer(4 + 64 + 4096);
  const worker = new Worker(new URL('./fixtures/shared-writer.mjs', import.meta.url), {
    workerData: { buffer, offset: 68, length: 4096 },
  });
  const control = new Int32Array(buffer, 0, 1);
  await Atomics.waitAsync(control, 0, 0).value;
  const shared = new Uint8Array(buffer, 4, 64);
  try {
    for (let i = 0; i < 20; i += 1) {
      gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, shared);
      assert.deepEqual(shared, unshared);
    }
  } finally {
    // Stop the writer even when an assertion fails, or it runs forever.
    Atomics.store(control, 0, 0);
    await once(worker, 'exit');
  }
  assert.equal(gl.getError(), gl.NO_ERROR);
});

test('buffer transferred after read', (t) => {
  const gl = context(t);
  const buffer = new ArrayBuffer(64);
  const pixels = new Uint8Array(buffer);
  gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const moved = structuredClone(buffer, { transfer: [buffer] });
  assert.equal(buffer.byteLength, 0);
  assert.equal(moved.byteLength, 64);
  // A read into the detached view writes nothing and does not crash.
  gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(moved));
  assert.equal(gl.getError(), gl.NO_ERROR);
});

test('readback constants', (t) => {
  const gl = context(t);
  assert.equal(gl.RGBA, 0x1908);
  assert.equal(gl.UNSIGNED_BYTE, 0x1401);
  assert.equal(gl.constructor.RGBA, 0x1908);
});

test('pack alignment changes the required size', (t) => {
  const gl = createContext({ width: 4, height: 4 });
  t.after(() => gl.destroy());
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 8);
  const fits = new Uint8Array(28).fill(7);
  gl.readPixels(0, 0, 3, 2, gl.RGBA, gl.UNSIGNED_BYTE, fits);
  assert.equal(gl.getError(), gl.NO_ERROR);
  // Row 0 at bytes 0-11, padding 12-15, row 1 at 16-27.
  assert.ok(fits.subarray(0, 12).every((b) => b === 255));
  assert.ok(fits.subarray(12, 16).every((b) => b === 7));
  assert.ok(fits.subarray(16, 28).every((b) => b === 255));
  const small = new Uint8Array(27).fill(7);
  gl.readPixels(0, 0, 3, 2, gl.RGBA, gl.UNSIGNED_BYTE, small);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  assert.ok(small.every((b) => b === 7));
});

test('WebGL 2 pack parameters', (t) => {
  const gl = createContext({ width: 4, height: 4, webgl2: true });
  t.after(() => gl.destroy());
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.pixelStorei(gl.PACK_ROW_LENGTH, 4);
  gl.pixelStorei(gl.PACK_SKIP_PIXELS, 1);
  const pixels = new Uint8Array(28).fill(7);
  gl.readPixels(0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  assert.equal(gl.getError(), gl.NO_ERROR);
  for (let i = 0; i < pixels.length; i += 1) {
    const written = (i >= 4 && i < 12) || (i >= 20 && i < 28);
    assert.equal(pixels[i], written ? 255 : 7, `byte ${String(i)}`);
  }
  const small = new Uint8Array(27).fill(7);
  gl.readPixels(0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, small);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
});

test('implementation read format', (t) => {
  for (const webgl2 of [false, true]) {
    const gl = createContext({ width: 4, height: 4, webgl2 });
    t.after(() => gl.destroy());
    const format = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT);
    const type = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE);
    const components = { [gl.RGBA]: 4, [gl.RGB]: 3, [gl.ALPHA]: 1 }[format] ?? 4;
    const View = type === gl.FLOAT ? Float32Array : type === gl.UNSIGNED_BYTE ? Uint8Array : Uint16Array;
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    gl.readPixels(0, 0, 1, 1, format, type, new View(components));
    assert.equal(gl.getError(), gl.NO_ERROR, `webgl2: ${String(webgl2)}`);
  }
});
