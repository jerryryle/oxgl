// pixel-readback spec scenarios.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { createContext, encodePNG } from '@oxgl-js/oxgl';

import { decodePng } from '../conformance/png.mjs';
import { allPixels, readAll } from './helpers.mjs';

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

// A driver's own read format for these can differ from the attachment's, and
// a read it refuses must not lose the context.
test('norm16 color buffers read as RGBA/UNSIGNED_SHORT', (t) => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  const ext = gl.getExtension('EXT_texture_norm16');
  if (!ext) {
    gl.destroy();
    return t.skip('no EXT_texture_norm16');
  }
  for (const [internal, format, expected] of [
    [ext.R16_EXT, gl.RED, [65535, 0, 0, 65535]],
    [ext.RG16_EXT, gl.RG, [65535, 65535, 0, 65535]],
    [ext.RGBA16_EXT, gl.RGBA, [65535, 65535, 65535, 65535]],
  ]) {
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, 1, 1, 0, format, gl.UNSIGNED_SHORT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gl.getParameter(gl.TEXTURE_BINDING_2D), 0);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const pixel = new Uint16Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_SHORT, pixel);
    assert.equal(gl.isContextLost(), false);
    assert.deepEqual([...pixel], expected);
    assert.equal(gl.getError(), gl.NO_ERROR);
  }
  gl.destroy();
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

/** The decoded image of the PNG that `encodePNG(gl)` resolves with. */
async function encoded(promise) {
  const png = await promise;
  assert.ok(Buffer.isBuffer(png), 'resolves with a Buffer');
  const image = decodePng(png);
  assert.ok(image !== undefined, 'a valid PNG');
  return image;
}

function near(actual, expected, tolerance = 1) {
  assert.ok(
    actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance),
    `${JSON.stringify(actual)} is not within ${String(tolerance)} of ${JSON.stringify(expected)}`,
  );
}

test('encodePNG writes rows top first', async (t) => {
  const gl = context(t, { width: 1, height: 2 });
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(0, 1, 1, 1);
  gl.clearColor(1, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.scissor(0, 0, 1, 1);
  gl.clearColor(0, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const image = await encoded(encodePNG(gl));
  assert.equal(image.width, 1);
  assert.equal(image.height, 2);
  assert.deepEqual([...image.data], [255, 0, 0, 255, 0, 255, 0, 255]);
});

test('encodePNG unpremultiplies a premultiplied buffer', async (t) => {
  const gl = context(t, { width: 1, height: 1 });
  gl.clearColor(0.5, 0, 0, 0.5);
  gl.clear(gl.COLOR_BUFFER_BIT);
  near([...(await encoded(encodePNG(gl))).data], [255, 0, 0, 128]);
});

test('encodePNG of a context without alpha is opaque', async (t) => {
  const gl = context(t, { width: 1, height: 1, attributes: { alpha: false } });
  gl.clearColor(0, 0, 1, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  assert.deepEqual([...(await encoded(encodePNG(gl))).data], [0, 0, 255, 255]);
});

test('encodePNG resolves an antialiased buffer', async (t) => {
  const gl = context(t, { attributes: { antialias: true } });
  gl.clearColor(0, 0, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  assert.ok(allPixels((await encoded(encodePNG(gl))).data, [0, 0, 255, 255]));
});

test('encodePNG reads the drawing buffer while a framebuffer object is bound', async (t) => {
  const gl = context(t);
  gl.clearColor(1, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.clearColor(0, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  assert.ok(allPixels((await encoded(encodePNG(gl))).data, [255, 0, 0, 255]));
});

test('encodePNG reads the drawing buffer after readBuffer(NONE)', async (t) => {
  for (const antialias of [false, true]) {
    const gl = context(t, { webgl2: true, attributes: { antialias } });
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.readBuffer(gl.NONE);
    assert.ok(allPixels((await encoded(encodePNG(gl))).data, [255, 0, 0, 255]), `antialias ${String(antialias)}`);
    assert.equal(gl.getParameter(gl.READ_BUFFER), gl.NONE);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    assert.equal(gl.getError(), gl.INVALID_OPERATION);
    // The page's read buffer was restored where reads of the drawing buffer go.
    gl.readBuffer(gl.BACK);
    assert.ok(allPixels(readAll(gl), [255, 0, 0, 255]), `antialias ${String(antialias)} after readBuffer(BACK)`);
    assert.equal(gl.getError(), gl.NO_ERROR);
  }
});

test('encodePNG after a resize has the new size', async (t) => {
  const gl = context(t);
  gl.resize(8, 2);
  const image = await encoded(encodePNG(gl));
  assert.equal(image.width, 8);
  assert.equal(image.height, 2);
});

test('encodePNG reads the pixels at the call', async (t) => {
  const gl = context(t);
  gl.clearColor(1, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const png = encodePNG(gl);
  gl.clearColor(0, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.destroy();
  assert.ok(allPixels((await encoded(png)).data, [255, 0, 0, 255]));
});

test('encodePNG is not affected by a resize after the call', async (t) => {
  const gl = context(t);
  gl.clearColor(1, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const png = encodePNG(gl);
  gl.resize(8, 2);
  gl.clearColor(0, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const image = await encoded(png);
  assert.equal(image.width, 4);
  assert.equal(image.height, 4);
  assert.ok(allPixels(image.data, [255, 0, 0, 255]));
});

test('encodePNG leaves state and errors unchanged', async (t) => {
  const gl = context(t, { webgl2: true });
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 8);
  gl.pixelStorei(gl.PACK_ROW_LENGTH, 3);
  gl.enable(0);
  await encoded(encodePNG(gl));
  assert.equal(gl.getParameter(gl.FRAMEBUFFER_BINDING), framebuffer);
  assert.equal(gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING), buffer);
  assert.equal(gl.getParameter(gl.PACK_ALIGNMENT), 8);
  assert.equal(gl.getParameter(gl.PACK_ROW_LENGTH), 3);
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  assert.equal(gl.getError(), gl.NO_ERROR);
});

test('encodePNG rejects a value that is not a context', async () => {
  let png;
  assert.doesNotThrow(() => {
    png = encodePNG({});
  });
  await assert.rejects(png, TypeError);
});

test('encodePNG rejects a destroyed context', async () => {
  const gl = createContext({ width: 4, height: 4 });
  gl.destroy();
  await assert.rejects(encodePNG(gl), { code: 'OXGL_CONTEXT_LOST' });
});

test('encodePNG rejects a lost context and encodes again after a restore', async (t) => {
  const gl = context(t);
  const lose = gl.getExtension('WEBGL_lose_context');
  gl.canvas.addEventListener('webglcontextlost', (event) => event.preventDefault());
  lose.loseContext();
  await once(gl.canvas, 'webglcontextlost');
  await assert.rejects(encodePNG(gl), { code: 'OXGL_CONTEXT_LOST' });
  lose.restoreContext();
  await once(gl.canvas, 'webglcontextrestored');
  gl.clearColor(1, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  assert.ok(allPixels((await encoded(encodePNG(gl))).data, [255, 0, 0, 255]));
});

test('encodePNG declarations need no Node types', () => {
  // A consumer with the DOM library and without @types/node type-checks the
  // built declarations; tsc exits non-zero on an error and prints it to stdout.
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  const project = fileURLToPath(new URL('fixtures/dom-types/tsconfig.json', import.meta.url));
  try {
    execFileSync(process.execPath, [tsc, '-p', project], { stdio: 'pipe' });
  } catch (error) {
    assert.fail(`tsc failed:\n${String(error.stdout)}${String(error.stderr)}`);
  }
});
