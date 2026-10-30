// context-creation spec scenarios.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { createContext, WebGL2RenderingContext, WebGLRenderingContext } from 'oxgl';

import { allPixels, countNativeCalls, liveContexts, readAll } from './helpers.mjs';

test('WebGL 1 context', () => {
  const gl = createContext({ width: 64, height: 32 });
  assert.ok(gl instanceof WebGLRenderingContext);
  assert.ok(!(gl instanceof WebGL2RenderingContext));
  assert.equal(gl.drawingBufferWidth, 64);
  assert.equal(gl.drawingBufferHeight, 32);
  gl.destroy();
});

test('WebGL 2 context', () => {
  const gl = createContext({ width: 64, height: 32, webgl2: true });
  assert.ok(gl instanceof WebGL2RenderingContext);
  assert.ok(!(gl instanceof WebGLRenderingContext));
  gl.destroy();
});

test('contexts cannot be constructed directly', () => {
  assert.throws(() => new WebGLRenderingContext(), TypeError);
  assert.throws(() => new WebGL2RenderingContext(), TypeError);
});

test('WebGL IDL constants: complete sets on the interface objects', () => {
  // The IDL's WebGLRenderingContextBase and WebGL2RenderingContextBase mixins
  // declare 297 and 262 constants; nothing else is an enumerable own property.
  assert.equal(Object.keys(WebGLRenderingContext).length, 297);
  assert.equal(Object.keys(WebGL2RenderingContext).length, 297 + 262);
  assert.equal(WebGLRenderingContext.POINTS, 0);
  assert.equal(WebGLRenderingContext.COLOR_BUFFER_BIT, 0x00004000);
  assert.equal(WebGL2RenderingContext.INVALID_INDEX, 0xffffffff);
  assert.equal(WebGL2RenderingContext.TIMEOUT_IGNORED, -1);
  assert.equal(WebGLRenderingContext.name, 'WebGLRenderingContext');
  assert.equal(WebGL2RenderingContext.name, 'WebGL2RenderingContext');
});

test('WebGL IDL constants: WebIDL property attributes', () => {
  for (const target of [
    WebGLRenderingContext,
    WebGLRenderingContext.prototype,
    WebGL2RenderingContext,
    WebGL2RenderingContext.prototype,
  ]) {
    assert.deepEqual(Object.getOwnPropertyDescriptor(target, 'RGBA'), {
      value: 0x1908,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
  for (const webgl2 of [false, true]) {
    const gl = createContext({ width: 1, height: 1, webgl2 });
    assert.equal(gl.RGBA, 0x1908);
    assert.equal(Object.hasOwn(gl, 'RGBA'), false);
    gl.destroy();
  }
});

test('WebGL IDL constants: WebGL 2-only constants absent from WebGL 1', () => {
  const gl = createContext({ width: 1, height: 1 });
  assert.equal(WebGLRenderingContext.READ_BUFFER, undefined);
  assert.equal(gl.READ_BUFFER, undefined);
  assert.equal(WebGL2RenderingContext.READ_BUFFER, 0x0c02);
  gl.destroy();
});

test('headless host: no DISPLAY or WAYLAND_DISPLAY', () => {
  const env = { ...process.env };
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;
  const script = `
    import { createContext } from 'oxgl';
    const gl = createContext({ width: 4, height: 4, backend: 'software' });
    gl.destroy();
    console.log('ok');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'ok');
});

test('missing dimensions throw TypeError and allocate nothing', () => {
  const before = liveContexts();
  assert.throws(() => createContext({ width: 10 }), TypeError);
  assert.throws(() => createContext({ width: '10', height: 10 }), TypeError);
  assert.equal(liveContexts(), before);
});

test('non-object options throw TypeError', () => {
  for (const options of [undefined, null, 5, 'opts']) {
    assert.throws(() => createContext(options), TypeError);
  }
});

test('negative, fractional or too-large sizes throw RangeError', () => {
  for (const size of [-1, 1.5, NaN, Infinity, 2147483648]) {
    assert.throws(() => createContext({ width: size, height: 10 }), RangeError, String(size));
    assert.throws(() => createContext({ width: 10, height: size }), RangeError, String(size));
  }
});

test('unknown backend throws TypeError listing the accepted values', () => {
  assert.throws(
    () => createContext({ width: 1, height: 1, backend: 'metal' }),
    (error) => error instanceof TypeError && /'auto', 'gpu', 'software'/.test(error.message),
  );
});

test('non-boolean webgl2 throws TypeError', () => {
  assert.throws(() => createContext({ width: 1, height: 1, webgl2: 1 }), TypeError);
});

test('requested size honored', () => {
  const gl = createContext({ width: 300, height: 150 });
  assert.equal(gl.drawingBufferWidth, 300);
  assert.equal(gl.drawingBufferHeight, 150);
  gl.destroy();
});

test('oversized request is clamped, preserving aspect ratio', () => {
  const width = 1_000_000;
  const height = 100;
  const gl = createContext({ width, height });
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  assert.ok(w > 0 && w < width, `${w}x${h}`);
  assert.ok(Math.abs(h - (w * height) / width) <= 1, `${w}x${h}`);
  gl.destroy();
});

test('drawing buffer attributes are read-only', () => {
  const gl = createContext({ width: 8, height: 4 });
  // Modules are strict, so assigning to a getter-only accessor throws.
  assert.throws(() => {
    gl.drawingBufferWidth = 5;
  }, TypeError);
  assert.equal(gl.drawingBufferWidth, 8);
  gl.destroy();
});

test('initial contents are zero', () => {
  const gl = createContext({ width: 16, height: 16 });
  assert.ok(readAll(gl).every((byte) => byte === 0));
  gl.destroy();
});

test('alpha channel is present', () => {
  const gl = createContext({ width: 2, height: 2 });
  gl.clearColor(0, 0, 0, 0.5);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const alpha = readAll(gl)[3];
  assert.ok(alpha === 127 || alpha === 128, String(alpha));
  gl.destroy();
});

test('contents persist between calls', () => {
  const gl = createContext({ width: 4, height: 4 });
  gl.clearColor(0.2, 0.4, 0.6, 0.8);
  gl.clear(gl.COLOR_BUFFER_BIT);
  assert.deepEqual(readAll(gl), readAll(gl));
  gl.destroy();
});

test('calls after destroy are inert and make no native call', () => {
  const gl = createContext({ width: 2, height: 2 });
  gl.destroy();
  const spy = countNativeCalls(['clearColor', 'clear', 'readPixels', 'getError', 'destroy']);
  try {
    const pixels = new Uint8Array(16).fill(7);
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.readPixels(0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.getError();
    gl.destroy();
    assert.ok(pixels.every((byte) => byte === 7));
  } finally {
    spy.restore();
  }
  assert.deepEqual(spy.counts, { clearColor: 0, clear: 0, readPixels: 0, getError: 0, destroy: 0 });
});

test('getError after destroy', () => {
  const gl = createContext({ width: 1, height: 1 });
  gl.destroy();
  assert.equal(gl.getError(), gl.CONTEXT_LOST_WEBGL);
  assert.equal(gl.getError(), gl.NO_ERROR);
});

test('double destroy', () => {
  const before = liveContexts();
  const gl = createContext({ width: 1, height: 1 });
  assert.equal(liveContexts(), before + 1);
  gl.destroy();
  gl.destroy();
  assert.equal(liveContexts(), before);
});

test('drawing buffer size after destroy', () => {
  const gl = createContext({ width: 7, height: 3 });
  gl.destroy();
  assert.equal(gl.drawingBufferWidth, 0);
  assert.equal(gl.drawingBufferHeight, 0);
});

test('interleaved contexts are independent', () => {
  const a = createContext({ width: 2, height: 2 });
  const b = createContext({ width: 2, height: 2 });
  a.clearColor(1, 0, 0, 1);
  b.clearColor(0, 0, 1, 1);
  a.clear(a.COLOR_BUFFER_BIT);
  b.clear(b.COLOR_BUFFER_BIT);
  a.clear(0x1);
  assert.ok(allPixels(readAll(a), [255, 0, 0, 255]));
  assert.ok(allPixels(readAll(b), [0, 0, 255, 255]));
  assert.equal(b.getError(), b.NO_ERROR);
  assert.equal(a.getError(), a.INVALID_VALUE);
  a.destroy();
  b.destroy();
});
