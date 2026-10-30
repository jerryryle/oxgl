// textures spec scenarios.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createContext, WebGLSampler, WebGLTexture } from 'oxgl';

import { program } from './gl-helpers.mjs';
import { readAll } from './helpers.mjs';

const VS = 'attribute vec2 p; varying vec2 v; void main() { v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
const FS = 'precision mediump float; uniform sampler2D t; varying vec2 v; void main() { gl_FragColor = texture2D(t, v); }';

/** A context drawing its bound 2D texture over the whole viewport. */
function textured(options = {}) {
  const gl = createContext({ width: 2, height: 2, ...options });
  gl.useProgram(program(gl, VS, FS));
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { gl, texture };
}

/** Draws and reads the 2×2 drawing buffer as four RGBA pixels, bottom row first. */
function draw(gl) {
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  const pixels = readAll(gl);
  return [0, 1, 2, 3].map((i) => [...pixels.subarray(i * 4, i * 4 + 4)]);
}

const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const BLUE = [0, 0, 255, 255];
const WHITE = [255, 255, 255, 255];
const QUAD = new Uint8Array([...RED, ...GREEN, ...BLUE, ...WHITE]);

test('bind per unit', () => {
  const gl = createContext({ width: 1, height: 1 });
  const a = gl.createTexture();
  const b = gl.createTexture();
  assert.ok(a instanceof WebGLTexture);
  assert.equal(gl.isTexture(a), false, 'not a texture until bound');
  gl.bindTexture(gl.TEXTURE_2D, a);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, b);
  assert.equal(gl.getParameter(gl.TEXTURE_BINDING_2D), b);
  gl.activeTexture(gl.TEXTURE0);
  assert.equal(gl.getParameter(gl.TEXTURE_BINDING_2D), a);
  assert.equal(gl.isTexture(a), true);
  gl.activeTexture(gl.TEXTURE0 + gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS));
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  assert.equal(gl.getParameter(gl.TEXTURE_BINDING_2D), a);
  gl.destroy();
});

test('target mismatch and deletion', () => {
  const gl = createContext({ width: 1, height: 1 });
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  assert.equal(gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP), null);
  gl.deleteTexture(texture);
  assert.equal(gl.getParameter(gl.TEXTURE_BINDING_2D), null);
  assert.equal(gl.isTexture(texture), false);
  gl.destroy();
});

test('parameters', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  assert.equal(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER), gl.NEAREST);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAX_LOD, 2.5);
  assert.equal(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MAX_LOD), 2.5);
  assert.equal(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_IMMUTABLE_FORMAT), false);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('sampled texture', () => {
  for (const webgl2 of [false, true]) {
    const { gl } = textured({ webgl2 });
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, QUAD);
    assert.deepEqual(draw(gl), [RED, GREEN, BLUE, WHITE]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(RED));
    assert.deepEqual(draw(gl), [RED, GREEN, BLUE, RED]);
    assert.equal(gl.getError(), gl.NO_ERROR);
    gl.destroy();
  }
});

test('wrong view type and view too small', () => {
  const { gl } = textured({ webgl2: true });
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Uint8Array(16));
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(63));
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.destroy();
});

test('flipped view upload', () => {
  for (const webgl2 of [false, true]) {
    const { gl } = textured({ webgl2 });
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, QUAD);
    assert.deepEqual(draw(gl), [BLUE, WHITE, RED, GREEN]);
    gl.destroy();
  }
});

test('premultiplied view upload', () => {
  const { gl } = textured();
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 128]));
  const [pixel] = draw(gl);
  for (const c of pixel) assert.ok(Math.abs(c - 128) <= 1, String(pixel));
  gl.destroy();
});

test('flip with a 3D upload from a view is INVALID_OPERATION', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  gl.bindTexture(gl.TEXTURE_3D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.destroy();
});

test('ImageData-shaped source converted to the requested type', () => {
  const { gl } = textured();
  const source = { width: 1, height: 1, data: new Uint8ClampedArray(RED) };
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_SHORT_5_6_5, source);
  assert.deepEqual(draw(gl)[0], RED);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('TexImageSource rows: top first, flipped with UNPACK_FLIP_Y_WEBGL', () => {
  const { gl } = textured();
  const source = { width: 2, height: 2, data: new Uint8ClampedArray(QUAD) };
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  assert.deepEqual(draw(gl), [RED, GREEN, BLUE, WHITE]);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  assert.deepEqual(draw(gl), [BLUE, WHITE, RED, GREEN]);
  gl.destroy();
});

test('WebGL 2 sub-rectangle of a TexImageSource', () => {
  const { gl } = textured({ webgl2: true });
  const source = { width: 2, height: 2, data: new Uint8ClampedArray(QUAD) };
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 1);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
  assert.deepEqual(draw(gl)[0], WHITE);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('canvas of another context', () => {
  const { gl } = textured();
  const other = createContext({ width: 2, height: 2 });
  other.clearColor(0, 0, 1, 1);
  other.clear(other.COLOR_BUFFER_BIT);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, other.canvas);
  assert.deepEqual(draw(gl), [BLUE, BLUE, BLUE, BLUE]);
  other.destroy();
  gl.destroy();
});

test('unsupported source', () => {
  const gl = createContext({ width: 1, height: 1 });
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  assert.throws(() => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, {}), TypeError);
  assert.throws(() => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, 0), TypeError);
  gl.destroy();
});

test('pixel unpack buffer forms', () => {
  const { gl } = textured({ webgl2: true });
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, buffer);
  gl.bufferData(gl.PIXEL_UNPACK_BUFFER, QUAD, gl.STATIC_DRAW);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, 0);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, QUAD);
  assert.equal(gl.getError(), gl.INVALID_OPERATION, 'a view while an unpack buffer is bound');
  gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
  assert.deepEqual(draw(gl), [RED, GREEN, BLUE, WHITE]);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, 0);
  assert.equal(gl.getError(), gl.INVALID_OPERATION, 'an offset with no unpack buffer');
  gl.destroy();
});

test('copy from an antialiased drawing buffer', () => {
  for (const webgl2 of [false, true]) {
    const { gl } = textured({ webgl2 });
    gl.clearColor(0, 1, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, 2, 2, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    assert.deepEqual(draw(gl), [GREEN, GREEN, GREEN, GREEN]);
    assert.equal(gl.getError(), gl.NO_ERROR);
    gl.destroy();
  }
});

test('immutable storage', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 2, 2);
  assert.equal(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_IMMUTABLE_FORMAT), true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.destroy();
});

test('no compressed formats yet', () => {
  const gl = createContext({ width: 1, height: 1 });
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.compressedTexImage2D(gl.TEXTURE_2D, 0, 0x83f0 /* COMPRESSED_RGB_S3TC_DXT1_EXT */, 4, 4, 0, new Uint8Array(8));
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  gl.destroy();
});

test('sampler overrides texture filtering', () => {
  const { gl } = textured({ webgl2: true });
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, QUAD);
  const sampler = gl.createSampler();
  assert.ok(sampler instanceof WebGLSampler);
  gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindSampler(0, sampler);
  assert.equal(gl.getParameter(gl.SAMPLER_BINDING), sampler);
  assert.equal(gl.getSamplerParameter(sampler, gl.TEXTURE_MIN_FILTER), gl.NEAREST);
  assert.equal(gl.isSampler(sampler), true);
  assert.deepEqual(draw(gl), [RED, GREEN, BLUE, WHITE]);
  gl.deleteSampler(sampler);
  assert.equal(gl.getParameter(gl.SAMPLER_BINDING), null);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('canvas sources are unpremultiplied and do not disturb the source context', () => {
  const { gl } = textured();
  const other = createContext({ width: 2, height: 2, webgl2: true });
  other.clearColor(1, 0, 0, 0.5);
  other.clear(other.COLOR_BUFFER_BIT);
  other.pixelStorei(other.PACK_ROW_LENGTH, 64);
  other.clear(0x1); // a pending error of the source's own
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, other.canvas);
  const [pixel] = draw(gl);
  const expected = [255, 0, 0, 128];
  pixel.forEach((c, i) => assert.ok(Math.abs(c - expected[i]) <= 2, String(pixel)));
  assert.equal(other.getError(), other.INVALID_VALUE);
  assert.equal(other.getError(), other.NO_ERROR);
  assert.equal(other.getParameter(other.PACK_ROW_LENGTH), 64);
  other.destroy();
  gl.destroy();
});

test('flip applies to depth uploads', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT16, 1, 2, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, new Uint16Array([1, 2]));
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT16, 1, 2, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, new Uint16Array([1]));
  assert.equal(gl.getError(), gl.INVALID_OPERATION, 'a short view is still rejected');
  gl.destroy();
});

test('deleting a texture bound only to a high unit', () => {
  const gl = createContext({ width: 1, height: 1 });
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.deleteTexture(texture);
  assert.equal(gl.getParameter(gl.TEXTURE_BINDING_2D), null);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('document images from another origin are refused', () => {
  const gl = createContext({ width: 1, height: 1 });
  // A document image as a DOM implementation presents one: its pixels come
  // through a 2D canvas the document creates.
  const document = {
    URL: 'http://a.test/page.html',
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {}, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }) }),
    }),
  };
  const image = (src, crossOrigin = null) => ({ naturalWidth: 1, naturalHeight: 1, src, crossOrigin, ownerDocument: document });
  const upload = (source) => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  assert.throws(() => upload(image('http://b.test/x.png')), (e) => e instanceof DOMException && e.name === 'SecurityError');
  for (const clean of [image('x.png'), image('http://a.test/x.png'), image('data:image/png;base64,AA=='), image('http://b.test/x.png', 'anonymous')]) {
    upload(clean);
  }
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('a host image decoder supplies unpremultiplied, and 16-bit, pixels', async () => {
  // A host that has an image's bytes (the conformance runner) decodes it.
  const { setImageDecoder } = await import('../dist/context.js');
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  const document = { URL: 'http://a.test/', createElement: () => assert.fail('the 2D canvas path is not used') };
  const image = { naturalWidth: 1, naturalHeight: 1, src: 'x.png', crossOrigin: null, ownerDocument: document };
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  try {
    // Alpha 1 keeps its color, which a premultiplied 2D canvas would lose.
    setImageDecoder(() => ({ data: new Uint8ClampedArray([255, 192, 128, 1]), width: 1, height: 1 }));
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const bytes = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    assert.deepEqual([...bytes], [255, 192, 128, 1]);
    // A 16-bit red of 64/65535 is 1/1023 in RGB10_A2, and 0 in 8 bits.
    setImageDecoder(() => ({ data: new Uint16Array([64, 0, 0, 65535]), width: 1, height: 1 }));
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB10_A2, gl.RGBA, gl.UNSIGNED_INT_2_10_10_10_REV, image);
    const packed = new Uint32Array(1);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_INT_2_10_10_10_REV, packed);
    assert.equal(packed[0] & 0x3ff, 1);
    assert.equal(gl.getError(), gl.NO_ERROR);
  } finally {
    setImageDecoder(undefined);
    gl.destroy();
  }
});

test('host image objects and size-less images go through the host decoder', async () => {
  const { setImageDecoder } = await import('../dist/context.js');
  const gl = createContext({ width: 1, height: 1 });
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  const bitmap = {};
  const document = { URL: 'http://a.test/', createElement: () => assert.fail('the 2D canvas path is not used') };
  const svg = { naturalWidth: 0, naturalHeight: 0, width: 2, height: 2, src: 'x.svg', crossOrigin: null, ownerDocument: document };
  const pixels = (n) => ({ data: new Uint8ClampedArray(n * n * 4).fill(255), width: n, height: n });
  try {
    setImageDecoder((source) => (source === bitmap ? pixels(1) : source === svg ? pixels(2) : undefined));
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, svg);
    // Level 0 is 2×2: a 1×1 write at (1, 1) fits.
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    assert.equal(gl.getError(), gl.NO_ERROR);
    setImageDecoder(undefined);
    assert.throws(() => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap), TypeError);
  } finally {
    setImageDecoder(undefined);
    gl.destroy();
  }
});

test('ImageBitmap pixels ignore the flip and premultiply unpack parameters', async () => {
  const { setImageDecoder } = await import('../dist/context.js');
  const gl = createContext({ width: 1, height: 1 });
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  const bitmap = {};
  try {
    // Top row red with alpha 128, bottom row green.
    setImageDecoder(() => ({ data: new Uint8ClampedArray([255, 0, 0, 128, 0, 255, 0, 255]), width: 1, height: 2, asIs: true }));
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const out = new Uint8Array(8);
    gl.readPixels(0, 0, 1, 2, gl.RGBA, gl.UNSIGNED_BYTE, out);
    assert.deepEqual([...out], [255, 0, 0, 128, 0, 255, 0, 255]);
    assert.equal(gl.getError(), gl.NO_ERROR);
  } finally {
    setImageDecoder(undefined);
    gl.destroy();
  }
});
