// drawingBufferFormat, drawingBufferStorage, drawingBufferColorSpace and
// unpackColorSpace: context-creation, textures and pixel-readback spec
// scenarios.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createContext, encodePNG } from '@oxgl-js/oxgl';

import { decodePng } from '../conformance/png.mjs';

const RGBA8 = 0x8058;
const RGB8 = 0x8051;
const RGBA16F = 0x881a;
const SRGB8_ALPHA8 = 0x8c43;

function context(t, options = {}) {
  const gl = createContext({ width: 16, height: 16, ...options });
  t.after(() => gl.destroy());
  return gl;
}

function pixel(gl, type = gl.UNSIGNED_BYTE) {
  const out = type === gl.FLOAT ? new Float32Array(4) : new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, type, out);
  return [...out];
}

function near(actual, expected, tolerance) {
  return actual.length === expected.length && actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Uploads `source` into a new texture and reads its first texel through a framebuffer. */
function texel(gl, source) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const out = pixel(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return out;
}

const imageData = (rgba, colorSpace) => ({ width: 1, height: 1, data: new Uint8ClampedArray(rgba), ...(colorSpace ? { colorSpace } : {}) });

/** The chunk types of a PNG, in order. */
function chunks(png) {
  const types = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    types.push({ type, body: png.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return types;
}

test('initial format', (t) => {
  assert.equal(context(t).drawingBufferFormat, RGBA8);
  assert.equal(context(t, { attributes: { alpha: false } }).drawingBufferFormat, RGB8);
});

test('RGBA8 storage', (t) => {
  const gl = context(t, { attributes: { antialias: false } });
  gl.drawingBufferStorage(RGBA8, 16, 32);
  assert.equal(gl.getError(), gl.NO_ERROR);
  assert.deepEqual([gl.drawingBufferFormat, gl.drawingBufferWidth, gl.drawingBufferHeight], [RGBA8, 16, 32]);
  gl.clearColor(16 / 255, 32 / 255, 64 / 255, 128 / 255);
  gl.clear(gl.COLOR_BUFFER_BIT);
  assert.deepEqual(pixel(gl), [16, 32, 64, 128]);
});

test('half-float storage', (t) => {
  const gl = context(t, { webgl2: true, attributes: { antialias: false } });
  assert.ok(gl.getExtension('EXT_color_buffer_float'));
  gl.drawingBufferStorage(gl.RGBA16F, 18, 28);
  assert.equal(gl.getError(), gl.NO_ERROR);
  assert.deepEqual([gl.drawingBufferFormat, gl.drawingBufferWidth, gl.drawingBufferHeight], [RGBA16F, 18, 28]);
  gl.clearColor(0.25, 0.5, 0.75, 0.125);
  gl.clear(gl.COLOR_BUFFER_BIT);
  assert.ok(near(pixel(gl, gl.FLOAT), [0.25, 0.5, 0.75, 0.125], 0.00001));
});

test('sRGB storage', (t) => {
  const gl = context(t, { webgl2: true, attributes: { antialias: false } });
  gl.drawingBufferStorage(gl.SRGB8_ALPHA8, 16, 32);
  assert.equal(gl.getError(), gl.NO_ERROR);
  assert.equal(gl.drawingBufferFormat, SRGB8_ALPHA8);
  gl.clearColor(srgbToLinear(64 / 255), srgbToLinear(16 / 255), srgbToLinear(32 / 255), 128 / 255);
  gl.clear(gl.COLOR_BUFFER_BIT);
  assert.ok(near(pixel(gl), [64, 16, 32, 128], 1), String(pixel(gl)));
});

test('resize keeps the format', (t) => {
  const gl = context(t, { webgl2: true });
  gl.getExtension('EXT_color_buffer_float');
  gl.drawingBufferStorage(gl.RGBA16F, 16, 16);
  gl.resize(8, 8);
  assert.deepEqual([gl.drawingBufferFormat, gl.drawingBufferWidth, gl.drawingBufferHeight], [RGBA16F, 8, 8]);
});

test('resize back to the canvas size after storage', (t) => {
  const gl = context(t);
  gl.drawingBufferStorage(RGBA8, 32, 32);
  gl.canvas.width = 16;
  assert.deepEqual([gl.drawingBufferWidth, gl.drawingBufferHeight, gl.drawingBufferFormat], [16, 16, RGBA8]);
});

test('drawingBufferStorage errors', (t) => {
  const opaque = context(t, { attributes: { alpha: false } });
  opaque.drawingBufferStorage(RGBA8, 16, 16);
  assert.equal(opaque.getError(), opaque.INVALID_OPERATION);

  const gl = context(t, { webgl2: true });
  gl.drawingBufferStorage(gl.RGBA16F, 16, 16);
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  assert.equal(gl.drawingBufferFormat, RGBA8);

  const max = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
  gl.drawingBufferStorage(RGBA8, max, max);
  assert.equal(gl.getError(), gl.NO_ERROR);
  const size = [gl.drawingBufferWidth, gl.drawingBufferHeight];
  assert.ok(size[0] <= max && size[1] <= max);
  gl.drawingBufferStorage(RGBA8, max + 1, 16);
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  assert.deepEqual([gl.drawingBufferWidth, gl.drawingBufferHeight], size);
});

// The budget is 1 GiB across renderbuffers and samples; the default buffer
// has RGBA8 color and 24-bit depth, plus an RGBA8 resolve when multisampled.
const BUDGET = 2 ** 30;

test('over the allocation budget', (t) => {
  const gl = context(t);
  const samples = gl.getParameter(gl.SAMPLES);
  assert.ok(samples > 0);
  const side = Math.min(8192, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), ...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
  if (side ** 2 * (samples * 8 + 4) <= BUDGET) {
    t.skip(`a ${side}x${side} buffer fits the budget multisampled`);
    return;
  }
  gl.drawingBufferStorage(RGBA8, side, side);
  assert.equal(gl.getError(), gl.NO_ERROR);
  assert.deepEqual([gl.drawingBufferWidth, gl.drawingBufferHeight], [side, side]);
  assert.equal(gl.getParameter(gl.SAMPLES), 0);
});

test('storage while lost, and restore', async (t) => {
  const gl = context(t, { webgl2: true });
  gl.getExtension('EXT_color_buffer_float');
  gl.drawingBufferStorage(gl.RGBA16F, 8, 8);
  gl.drawingBufferColorSpace = 'display-p3';
  gl.unpackColorSpace = 'display-p3';
  const lose = gl.getExtension('WEBGL_lose_context');
  gl.canvas.addEventListener('webglcontextlost', (event) => event.preventDefault());
  lose.loseContext();
  gl.drawingBufferStorage(RGBA8, 4, 4);
  assert.equal(gl.getError(), gl.CONTEXT_LOST_WEBGL);
  assert.equal(gl.getError(), gl.NO_ERROR);
  const restored = new Promise((resolve) => {
    gl.canvas.addEventListener('webglcontextrestored', resolve);
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  lose.restoreContext();
  await restored;
  assert.equal(gl.drawingBufferFormat, RGBA8);
  assert.equal(gl.drawingBufferColorSpace, 'display-p3');
  assert.equal(gl.unpackColorSpace, 'display-p3');
});

test('drawingBufferColorSpace values', (t) => {
  const gl = context(t);
  assert.equal(gl.drawingBufferColorSpace, 'srgb');
  gl.drawingBufferColorSpace = 'display-p3';
  assert.equal(gl.drawingBufferColorSpace, 'display-p3');
  gl.drawingBufferColorSpace = 'rec2020';
  assert.equal(gl.drawingBufferColorSpace, 'display-p3');
  assert.throws(() => {
    gl.drawingBufferColorSpace = Symbol('srgb');
  }, TypeError);
});

test('changing drawingBufferColorSpace clears the buffer', (t) => {
  const gl = context(t, { attributes: { antialias: false } });
  gl.clearColor(1, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawingBufferColorSpace = 'display-p3';
  assert.deepEqual(pixel(gl), [0, 0, 0, 0]);
});

test('unpackColorSpace conversions', (t) => {
  const gl = context(t);
  assert.equal(gl.unpackColorSpace, 'srgb');
  assert.deepEqual(texel(gl, imageData([200, 100, 50, 255])), [200, 100, 50, 255]);
  gl.unpackColorSpace = 'display-p3';
  assert.ok(near(texel(gl, imageData([255, 0, 0, 255])), [234, 51, 35, 255], 2));
  // Views are not converted.
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 0, 0, 255]));
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  assert.deepEqual(pixel(gl), [255, 0, 0, 255]);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  // NONE turns the conversion off.
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  assert.deepEqual(texel(gl, imageData([255, 0, 0, 255])), [255, 0, 0, 255]);
});

test('Display P3 sources into sRGB', (t) => {
  const gl = context(t);
  assert.ok(near(texel(gl, imageData([234, 51, 35, 255], 'display-p3')), [255, 0, 0, 255], 2));
  assert.deepEqual(texel(gl, imageData([0, 255, 0, 255], 'display-p3')), [0, 255, 0, 255]);

  const source = context(t, { attributes: { antialias: false } });
  source.drawingBufferColorSpace = 'display-p3';
  source.clearColor(234 / 255, 51 / 255, 35 / 255, 1);
  source.clear(source.COLOR_BUFFER_BIT);
  assert.ok(near(texel(gl, source.canvas), [255, 0, 0, 255], 2));
});

test('half-float buffer as a PNG', async (t) => {
  const gl = context(t, { webgl2: true });
  gl.getExtension('EXT_color_buffer_float');
  gl.drawingBufferStorage(gl.RGBA16F, 2, 2);
  gl.clearColor(2.0, 0.5, -1.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const { data } = decodePng(Buffer.from(await encodePNG(gl)));
  assert.ok(near([...data.subarray(0, 4)], [255, 128, 0, 255], 1), String([...data.subarray(0, 4)]));
});

test('half-float buffer unpremultiplies before rounding', async (t) => {
  const gl = context(t, { webgl2: true });
  gl.getExtension('EXT_color_buffer_float');
  gl.drawingBufferStorage(gl.RGBA16F, 2, 2);
  // 50% gray at 1% alpha, premultiplied: 8-bit rounding first would give 85.
  gl.clearColor(0.005, 0.005, 0.005, 0.01);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const { data } = decodePng(Buffer.from(await encodePNG(gl)));
  assert.ok(near([...data.subarray(0, 4)], [128, 128, 128, 3], 2), String([...data.subarray(0, 4)]));
});

test('half-float buffer read in bands keeps its rows in order', async (t) => {
  // 4096 wide: 256 rows of floats a band, so 601 rows take three bands, and
  // an odd count leaves a middle row in place when flipped.
  const gl = context(t, { webgl2: true, attributes: { antialias: false } });
  gl.getExtension('EXT_color_buffer_float');
  gl.drawingBufferStorage(gl.RGBA16F, 4096, 601);
  gl.enable(gl.SCISSOR_TEST);
  for (const [y, color] of [[0, [1, 0, 0, 1]], [300, [0, 1, 0, 1]], [600, [0, 0, 1, 1]]]) {
    gl.scissor(0, y, 4096, 1);
    gl.clearColor(...color);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  const { data, width } = decodePng(Buffer.from(await encodePNG(gl)));
  const row = (y) => [...data.subarray(y * width * 4, y * width * 4 + 4)];
  // PNG rows are top first: GL's row 600 is PNG row 0.
  assert.deepEqual([row(0), row(300), row(600), row(1)], [[0, 0, 255, 255], [0, 255, 0, 255], [255, 0, 0, 255], [0, 0, 0, 0]]);
});

test('sRGB buffer uploaded to another context', (t) => {
  const source = context(t, { webgl2: true, attributes: { antialias: false } });
  source.drawingBufferStorage(source.SRGB8_ALPHA8, 4, 4);
  source.clearColor(srgbToLinear(64 / 255), srgbToLinear(32 / 255), srgbToLinear(16 / 255), 1);
  source.clear(source.COLOR_BUFFER_BIT);
  assert.ok(near(texel(context(t), source.canvas), [64, 32, 16, 255], 1));
});

test('semi-transparent sRGB buffer divides its encoded values', (t) => {
  const source = context(t, { webgl2: true, attributes: { antialias: false } });
  source.drawingBufferStorage(source.SRGB8_ALPHA8, 4, 4);
  source.clearColor(srgbToLinear(32 / 255), srgbToLinear(64 / 255), srgbToLinear(16 / 255), 64 / 255);
  source.clear(source.COLOR_BUFFER_BIT);
  assert.ok(near(texel(context(t), source.canvas), [128, 255, 64, 64], 5));
});

test('PNG color space chunks', async (t) => {
  const p3 = context(t);
  p3.drawingBufferColorSpace = 'display-p3';
  const tagged = chunks(Buffer.from(await encodePNG(p3)));
  const cicp = tagged.findIndex((c) => c.type === 'cICP');
  assert.ok(cicp > 0 && cicp < tagged.findIndex((c) => c.type === 'IDAT'));
  assert.deepEqual([...tagged[cicp].body], [12, 13, 0, 1]);

  const plain = chunks(Buffer.from(await encodePNG(context(t)))).map((c) => c.type);
  for (const type of ['cICP', 'iCCP', 'sRGB', 'gAMA']) assert.ok(!plain.includes(type), type);
});
