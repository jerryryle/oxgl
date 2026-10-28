// error-reporting spec scenarios. Backend device loss cannot be triggered from
// JS yet (no WEBGL_lose_context); the Rust test device_loss_enters_the_lost_state
// in oxgl-core covers it through GL_CHROMIUM_lose_context.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createContext, WebGLRenderingContext } from 'oxgl';

function context(t) {
  const gl = createContext({ width: 2, height: 2 });
  t.after(() => gl.destroy());
  return gl;
}

test('no error initially', (t) => {
  assert.equal(context(t).getError(), 0);
});

test('error is reported once', (t) => {
  const gl = context(t);
  gl.clear(0x1);
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  assert.equal(gl.getError(), gl.NO_ERROR);
});

test('validation and GL errors share flags', (t) => {
  const gl = context(t);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Float32Array(4));
  gl.clear(0x1);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  assert.equal(gl.getError(), gl.NO_ERROR);
});

test('lost context', () => {
  const gl = createContext({ width: 1, height: 1 });
  gl.clear(0x1);
  gl.destroy();
  assert.deepEqual(
    [gl.getError(), gl.getError(), gl.getError()],
    [gl.CONTEXT_LOST_WEBGL, gl.NO_ERROR, gl.NO_ERROR],
  );
});

test('error constants', (t) => {
  const gl = context(t);
  const expected = {
    NO_ERROR: 0,
    INVALID_ENUM: 0x0500,
    INVALID_VALUE: 0x0501,
    INVALID_OPERATION: 0x0502,
    INVALID_FRAMEBUFFER_OPERATION: 0x0506,
    OUT_OF_MEMORY: 0x0505,
    CONTEXT_LOST_WEBGL: 0x9242,
  };
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(gl[name], value, name);
    assert.equal(WebGLRenderingContext[name], value, name);
  }
  assert.throws(() => {
    WebGLRenderingContext.NO_ERROR = 1;
  }, TypeError);
});
