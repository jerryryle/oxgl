// drawing-buffer change: context attributes, antialiasing, the default
// framebuffer, getContextAttributes, the canvas attribute, HeadlessCanvas and
// resize (context-creation spec).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createContext, HeadlessCanvas } from 'oxgl';

import { allPixels, liveContexts, readAll, withBackendEnv } from './helpers.mjs';

const software = process.env.OXGL_BACKEND === 'software';

test('zero size gives a one-pixel dimension', () => {
  const gl = createContext({ width: 0, height: 10 });
  assert.equal(gl.drawingBufferWidth, 1);
  assert.equal(gl.drawingBufferHeight, 10);
  gl.destroy();
});

test('canvas option must be an object', () => {
  const before = liveContexts();
  for (const canvas of [1, 'c', true, null]) {
    assert.throws(() => createContext({ width: 1, height: 1, canvas }), TypeError, String(canvas));
  }
  assert.equal(liveContexts(), before);
});

test('attributes: defaults', () => {
  const gl = createContext({ width: 4, height: 4 });
  assert.deepEqual(gl.getContextAttributes(), {
    alpha: true,
    antialias: true,
    depth: true,
    desynchronized: false,
    failIfMajorPerformanceCaveat: false,
    powerPreference: 'default',
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    stencil: false,
  });
  gl.destroy();
});

test('attributes: boolean conversion', () => {
  const gl = createContext({ width: 4, height: 4, attributes: { depth: 0, stencil: 'yes' } });
  const attributes = gl.getContextAttributes();
  assert.equal(attributes.depth, false);
  assert.equal(attributes.stencil, true);
  assert.equal(gl.getParameter(gl.DEPTH_BITS), 0);
  assert.ok(gl.getParameter(gl.STENCIL_BITS) >= 8);
  gl.destroy();
});

test('attributes: invalid power preference or non-object', () => {
  const before = liveContexts();
  assert.throws(() => createContext({ width: 4, height: 4, attributes: { powerPreference: 'fast' } }), TypeError);
  assert.throws(() => createContext({ width: 4, height: 4, attributes: 5 }), TypeError);
  assert.equal(liveContexts(), before);
  const gl = createContext({ width: 4, height: 4, attributes: null });
  assert.equal(gl.getContextAttributes().alpha, true);
  gl.destroy();
});

test('no alpha channel', () => {
  for (const webgl2 of [false, true]) {
    const gl = createContext({ width: 4, height: 4, webgl2, attributes: { alpha: false } });
    gl.clearColor(0, 0, 0, 0.5);
    gl.clear(gl.COLOR_BUFFER_BIT);
    assert.ok(allPixels(readAll(gl), [0, 0, 0, 255]));
    assert.equal(gl.getParameter(gl.ALPHA_BITS), 0);
    assert.equal(gl.getError(), gl.NO_ERROR);
    gl.destroy();
  }
});

test('depth and stencil on request', () => {
  const cases = [
    [{ depth: false, stencil: true }, 0, 8],
    [{ depth: true, stencil: true }, 16, 8],
    [{}, 16, 0],
  ];
  for (const [attributes, depth, stencil] of cases) {
    const gl = createContext({ width: 4, height: 4, attributes });
    const depthBits = gl.getParameter(gl.DEPTH_BITS);
    const stencilBits = gl.getParameter(gl.STENCIL_BITS);
    if (depth === 0) assert.equal(depthBits, 0);
    else assert.ok(depthBits >= depth, JSON.stringify(attributes));
    if (stencil === 0) assert.equal(stencilBits, 0);
    else assert.ok(stencilBits >= stencil, JSON.stringify(attributes));
    gl.destroy();
  }
});

test('multisampled by default', { skip: !software && 'sample count checked on SwiftShader' }, () => {
  for (const webgl2 of [false, true]) {
    const gl = createContext({ width: 4, height: 4, webgl2 });
    assert.equal(gl.getParameter(gl.SAMPLES), 4);
    assert.equal(gl.getParameter(gl.SAMPLE_BUFFERS), 1);
    assert.equal(gl.getContextAttributes().antialias, true);
    gl.destroy();
  }
});

test('sample count capped by the WebGL 2 maximum', () => {
  const gl = createContext({ width: 4, height: 4, webgl2: true });
  assert.ok(gl.getParameter(gl.SAMPLES) <= gl.getParameter(gl.MAX_SAMPLES));
  gl.destroy();
});

test('reading an antialiased buffer', () => {
  for (const webgl2 of [false, true]) {
    const gl = createContext({ width: 8, height: 8, webgl2 });
    gl.clearColor(0, 1, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    assert.ok(allPixels(readAll(gl), [0, 255, 0, 255]));
    assert.equal(gl.getError(), gl.NO_ERROR);
    gl.destroy();
  }
});

test('antialias off', () => {
  const gl = createContext({ width: 4, height: 4, attributes: { antialias: false } });
  assert.equal(gl.getParameter(gl.SAMPLES), 0);
  assert.equal(gl.getContextAttributes().antialias, false);
  gl.destroy();
});

test('no visible framebuffer object', () => {
  const gl = createContext({ width: 4, height: 4 });
  assert.equal(gl.getParameter(gl.FRAMEBUFFER_BINDING), null);
  assert.equal(gl.getParameter(gl.RENDERBUFFER_BINDING), null);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('errors survive a resolve', () => {
  const gl = createContext({ width: 4, height: 4 });
  gl.clear(0x1);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('default draw and read buffers', () => {
  const gl = createContext({ width: 4, height: 4, webgl2: true });
  assert.equal(gl.getParameter(gl.DRAW_BUFFER0), gl.BACK);
  assert.equal(gl.getParameter(gl.DRAW_BUFFER1), gl.NONE);
  assert.equal(gl.getParameter(gl.READ_BUFFER), gl.BACK);
  assert.equal(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), null);
  assert.equal(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), null);
  const max = gl.getParameter(gl.MAX_DRAW_BUFFERS);
  if (max < 16) {
    assert.equal(gl.getParameter(gl.DRAW_BUFFER0 + max), null);
    assert.equal(gl.getError(), gl.INVALID_ENUM);
  }
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('implementation read format of the drawing buffer is readable', () => {
  for (const webgl2 of [false, true]) {
    for (const antialias of [false, true]) {
      for (const alpha of [false, true]) {
        const gl = createContext({ width: 4, height: 4, webgl2, attributes: { alpha, antialias } });
        const format = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT);
        const type = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE);
        assert.equal(gl.getError(), gl.NO_ERROR);
        gl.readPixels(0, 0, 1, 1, format, type, new Uint8Array(16));
        assert.equal(gl.getError(), gl.NO_ERROR, JSON.stringify({ webgl2, antialias, alpha, format, type }));
        gl.destroy();
      }
    }
  }
});

test('getContextAttributes: reported values, new object per call, null when lost', () => {
  const gl = createContext({ width: 4, height: 4, attributes: { alpha: false, preserveDrawingBuffer: true } });
  const first = gl.getContextAttributes();
  assert.equal(first.alpha, false);
  assert.equal(first.preserveDrawingBuffer, true);
  first.alpha = true;
  assert.notEqual(gl.getContextAttributes(), first);
  assert.equal(gl.getContextAttributes().alpha, false);
  gl.destroy();
  assert.equal(gl.getContextAttributes(), null);
});

test('failIfMajorPerformanceCaveat: software refused', () => {
  withBackendEnv('software', () => {
    const before = liveContexts();
    assert.throws(
      () => createContext({ width: 4, height: 4, attributes: { failIfMajorPerformanceCaveat: true } }),
      (error) => error.code === 'OXGL_CONTEXT_CREATION_FAILED' && /failIfMajorPerformanceCaveat/.test(error.message),
    );
    assert.equal(liveContexts(), before);
  });
});

test('failIfMajorPerformanceCaveat: auto behaves as gpu', { skip: !software && 'needs a host without a GPU' }, (t) => {
  withBackendEnv(undefined, () => {
    let gpu = null;
    try {
      gpu = createContext({ width: 1, height: 1, backend: 'gpu' });
    } catch {
      // No GPU: the case under test.
    }
    if (gpu !== null) {
      gpu.destroy();
      t.skip('this host has a GPU');
      return;
    }
    assert.throws(
      () => createContext({ width: 4, height: 4, attributes: { failIfMajorPerformanceCaveat: true } }),
      (error) => error.code === 'OXGL_GPU_UNAVAILABLE',
    );
  });
});

test("canvas attribute: the caller's canvas", () => {
  const element = {};
  const gl = createContext({ width: 4, height: 4, canvas: element });
  assert.equal(gl.canvas, element);
  assert.equal(gl.canvas, element);
  gl.destroy();
});

test('canvas attribute: HeadlessCanvas', () => {
  const gl = createContext({ width: 4, height: 6 });
  assert.ok(gl.canvas instanceof HeadlessCanvas);
  assert.ok(gl.canvas instanceof EventTarget);
  assert.equal(gl.canvas, gl.canvas);
  assert.equal(gl.canvas.width, 4);
  assert.equal(gl.canvas.height, 6);
  assert.throws(() => {
    gl.canvas = {};
  }, TypeError);
  gl.destroy();
});

test('HeadlessCanvas: not constructible', () => {
  assert.throws(() => new HeadlessCanvas(), TypeError);
});

test('HeadlessCanvas: resize through the canvas, out-of-range values', () => {
  const gl = createContext({ width: 4, height: 4 });
  gl.canvas.width = 20;
  assert.equal(gl.canvas.width, 20);
  assert.equal(gl.drawingBufferWidth, 20);
  gl.canvas.width = -1;
  assert.equal(gl.canvas.width, 300);
  assert.equal(gl.drawingBufferWidth, 300);
  gl.canvas.height = 2 ** 32 + 7;
  assert.equal(gl.canvas.height, 7);
  assert.equal(gl.drawingBufferHeight, 7);
  gl.destroy();
});

test('HeadlessCanvas: canvas of a destroyed context', () => {
  const gl = createContext({ width: 4, height: 4 });
  gl.destroy();
  gl.canvas.width = 20;
  assert.equal(gl.canvas.width, 20);
  assert.equal(gl.drawingBufferWidth, 0);
});

test('resize keeps the viewport and clears', () => {
  const gl = createContext({ width: 10, height: 20 });
  gl.clearColor(1, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.resize(20, 10);
  assert.deepEqual([...gl.getParameter(gl.VIEWPORT)], [0, 0, 10, 20]);
  assert.equal(gl.drawingBufferWidth, 20);
  assert.equal(gl.drawingBufferHeight, 10);
  assert.ok(allPixels(readAll(gl), [0, 0, 0, 0]));
  gl.destroy();
});

test('resize to the same size keeps the contents', () => {
  const gl = createContext({ width: 4, height: 4 });
  gl.clearColor(1, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.resize(4, 4);
  assert.ok(allPixels(readAll(gl), [255, 0, 0, 255]));
  gl.canvas.width = 4;
  assert.ok(allPixels(readAll(gl), [255, 0, 0, 255]));
  gl.destroy();
});

test('resize keeps state that affects clearing', () => {
  for (const webgl2 of [false, true]) {
    const gl = createContext({ width: 4, height: 4, webgl2 });
    gl.clearColor(1, 0, 0, 1);
    gl.colorMask(true, false, false, false);
    gl.enable(gl.SCISSOR_TEST);
    gl.resize(6, 6);
    assert.ok(allPixels(readAll(gl), [0, 0, 0, 0]));
    assert.deepEqual([...gl.getParameter(gl.COLOR_CLEAR_VALUE)], [1, 0, 0, 1]);
    assert.deepEqual(gl.getParameter(gl.COLOR_WRITEMASK), [true, false, false, false]);
    assert.equal(gl.isEnabled(gl.SCISSOR_TEST), true);
    assert.equal(gl.getError(), gl.NO_ERROR);
    gl.destroy();
  }
});

test('resize: invalid sizes throw RangeError and change nothing', () => {
  const gl = createContext({ width: 4, height: 4 });
  for (const [w, h] of [
    [-1, 4],
    [1.5, 4],
    [2147483648, 4],
  ]) {
    assert.throws(() => gl.resize(w, h), RangeError);
  }
  assert.equal(gl.drawingBufferWidth, 4);
  assert.equal(gl.canvas.width, 4);
  gl.destroy();
});

test('resize: canvas keeps the requested size', () => {
  const gl = createContext({ width: 4, height: 4 });
  const [max] = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  gl.resize(max + 100, 4);
  assert.equal(gl.canvas.width, max + 100);
  assert.ok(gl.drawingBufferWidth <= max);
  gl.destroy();
});

test('resize on a lost context does nothing', () => {
  const gl = createContext({ width: 4, height: 4 });
  gl.destroy();
  gl.resize(8, 8);
  assert.equal(gl.drawingBufferWidth, 0);
  assert.equal(gl.canvas.width, 4);
});

test('compositing clears only without preserveDrawingBuffer', async () => {
  // A host that composites canvases (the conformance runner) calls this.
  const { presentDrawingBuffer } = await import('../dist/context.js');
  for (const preserveDrawingBuffer of [false, true]) {
    const gl = createContext({ width: 2, height: 2, attributes: { preserveDrawingBuffer } });
    gl.clearColor(1, 0, 0, 1);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, 1, 1);
    gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    presentDrawingBuffer(gl);
    assert.equal(gl.getParameter(gl.FRAMEBUFFER_BINDING), fbo);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    assert.ok(allPixels(readAll(gl), preserveDrawingBuffer ? [255, 0, 0, 255] : [0, 0, 0, 0]));
    assert.deepEqual([...gl.getParameter(gl.COLOR_CLEAR_VALUE)], [1, 0, 0, 1]);
    assert.equal(gl.isEnabled(gl.SCISSOR_TEST), true);
    gl.destroy();
  }
});

test('compositing keeps per-draw-buffer color masks', async (t) => {
  const { presentDrawingBuffer } = await import('../dist/context.js');
  const gl = createContext({ width: 2, height: 2, webgl2: true });
  const ext = gl.getExtension('OES_draw_buffers_indexed');
  if (ext === null) {
    t.skip('OES_draw_buffers_indexed unavailable');
    gl.destroy();
    return;
  }
  ext.colorMaskiOES(0, false, true, false, false);
  ext.colorMaskiOES(1, true, false, false, false);
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  presentDrawingBuffer(gl);
  assert.ok(allPixels(readAll(gl), [0, 0, 0, 0]));
  assert.deepEqual([...gl.getIndexedParameter(gl.COLOR_WRITEMASK, 0)], [false, true, false, false]);
  assert.deepEqual([...gl.getIndexedParameter(gl.COLOR_WRITEMASK, 1)], [true, false, false, false]);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('compositing clears even with the draw buffer set to NONE', async () => {
  const { presentDrawingBuffer } = await import('../dist/context.js');
  const gl = createContext({ width: 2, height: 2, webgl2: true });
  gl.clearColor(1, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawBuffers([gl.NONE]);
  presentDrawingBuffer(gl);
  assert.equal(gl.getParameter(gl.DRAW_BUFFER0), gl.NONE);
  assert.ok(allPixels(readAll(gl), [0, 0, 0, 0]));
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('a forced present clears with preserveDrawingBuffer too', async () => {
  // An OffscreenCanvas's transferToImageBitmap leaves a cleared buffer.
  const { presentDrawingBuffer } = await import('../dist/context.js');
  const gl = createContext({ width: 2, height: 2, attributes: { preserveDrawingBuffer: true } });
  gl.clearColor(1, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  presentDrawingBuffer(gl);
  assert.ok(allPixels(readAll(gl), [255, 0, 0, 255]));
  presentDrawingBuffer(gl, true);
  assert.ok(allPixels(readAll(gl), [0, 0, 0, 0]));
  gl.destroy();
});

test('oxgl methods outside WebIDL are not enumerable', () => {
  const gl = createContext({ width: 1, height: 1 });
  const names = [];
  for (const name in gl) names.push(name);
  assert.ok(names.includes('drawArrays'));
  assert.ok(!names.includes('resize') && !names.includes('destroy'));
  gl.destroy();
});
