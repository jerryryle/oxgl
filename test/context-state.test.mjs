// context-state spec scenarios: state setters, enable/disable, pixel storage,
// WebIDL conversion and lost-context behavior.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createContext } from 'oxgl';

function context(t, options = {}) {
  const gl = createContext({ width: 4, height: 4, ...options });
  t.after(() => gl.destroy());
  return gl;
}

/** Asserts the next `getError()` is `code`, then that no other error is pending. */
function expectError(gl, code, message) {
  assert.equal(gl.getError(), code, message);
  assert.equal(gl.getError(), gl.NO_ERROR, message);
}

test('valid state calls generate no error', (t) => {
  for (const webgl2 of [false, true]) {
    const gl = context(t, { webgl2 });
    gl.activeTexture(gl.TEXTURE1);
    gl.blendColor(0.1, 0.2, 0.3, 0.4);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_SUBTRACT);
    gl.blendFunc(gl.ONE, gl.ZERO);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ZERO);
    gl.clearDepth(0.25);
    gl.clearStencil(1);
    gl.colorMask(true, false, true, false);
    gl.cullFace(gl.FRONT);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.depthRange(0.25, 0.75);
    gl.frontFace(gl.CW);
    gl.hint(gl.GENERATE_MIPMAP_HINT, gl.NICEST);
    gl.lineWidth(1);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.polygonOffset(1, 2);
    gl.sampleCoverage(0.5, true);
    gl.scissor(0, 0, 2, 2);
    gl.stencilFunc(gl.EQUAL, 1, 0xff);
    gl.stencilFuncSeparate(gl.BACK, gl.LESS, 2, 0x0f);
    gl.stencilMask(0xff);
    gl.stencilMaskSeparate(gl.FRONT, 0x0f);
    gl.stencilOp(gl.KEEP, gl.INCR, gl.DECR);
    gl.stencilOpSeparate(gl.BACK, gl.ZERO, gl.REPLACE, gl.INVERT);
    gl.viewport(0, 0, 4, 4);
    assert.equal(gl.getError(), gl.NO_ERROR, `webgl2: ${String(webgl2)}`);
  }
});

test('toggle a capability', (t) => {
  const gl = context(t);
  assert.equal(gl.isEnabled(gl.DEPTH_TEST), false);
  gl.enable(gl.DEPTH_TEST);
  assert.equal(gl.isEnabled(gl.DEPTH_TEST), true);
  gl.disable(gl.DEPTH_TEST);
  assert.equal(gl.isEnabled(gl.DEPTH_TEST), false);
  assert.equal(gl.getError(), gl.NO_ERROR);
});

test('desktop-only capability rejected', (t) => {
  const gl = context(t);
  gl.enable(0x0b10); // GL_POINT_SMOOTH
  expectError(gl, gl.INVALID_ENUM);
  assert.equal(gl.isEnabled(0x0b10), false);
  expectError(gl, gl.INVALID_ENUM);
});

test('WebGL 2 capability on WebGL 1', (t) => {
  const gl1 = context(t);
  gl1.enable(0x8c89); // RASTERIZER_DISCARD
  expectError(gl1, gl1.INVALID_ENUM);
  const gl2 = context(t, { webgl2: true });
  gl2.enable(gl2.RASTERIZER_DISCARD);
  assert.equal(gl2.isEnabled(gl2.RASTERIZER_DISCARD), true);
  assert.equal(gl2.getError(), gl2.NO_ERROR);
});

test('invalid blend enum', (t) => {
  const gl = context(t);
  gl.blendFunc(0x1234, gl.ONE);
  expectError(gl, gl.INVALID_ENUM);
});

test('constant color with constant alpha is rejected', (t) => {
  const gl = context(t);
  gl.blendFunc(gl.CONSTANT_COLOR, gl.CONSTANT_ALPHA);
  expectError(gl, gl.INVALID_OPERATION);
});

test('depth range near above far', (t) => {
  const gl = context(t);
  gl.depthRange(1, 0);
  expectError(gl, gl.INVALID_OPERATION);
});

test('out-of-range texture unit', (t) => {
  const gl = context(t);
  gl.activeTexture(gl.TEXTURE0 + 4096);
  expectError(gl, gl.INVALID_ENUM);
});

test('negative scissor size', (t) => {
  const gl = context(t);
  gl.scissor(0, 0, -1, 4);
  expectError(gl, gl.INVALID_VALUE);
});

test('pixel storage errors', (t) => {
  const gl1 = context(t);
  gl1.pixelStorei(gl1.PACK_ALIGNMENT, 3);
  expectError(gl1, gl1.INVALID_VALUE, 'bad alignment');
  gl1.pixelStorei(0x0d02, 1); // PACK_ROW_LENGTH
  expectError(gl1, gl1.INVALID_ENUM, 'WebGL 2 parameter on WebGL 1');
  gl1.pixelStorei(gl1.UNPACK_COLORSPACE_CONVERSION_WEBGL, 0x1234);
  expectError(gl1, gl1.INVALID_VALUE, 'bad colorspace conversion');
  gl1.pixelStorei(gl1.UNPACK_FLIP_Y_WEBGL, 5);
  gl1.pixelStorei(gl1.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  gl1.pixelStorei(gl1.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl1.NONE);
  assert.equal(gl1.getError(), gl1.NO_ERROR, 'WebGL-only parameters');
  const gl2 = context(t, { webgl2: true });
  gl2.pixelStorei(gl2.PACK_ROW_LENGTH, 1);
  assert.equal(gl2.getError(), gl2.NO_ERROR, 'WebGL 2 parameter on WebGL 2');
});

test('numeric and boolean conversion', (t) => {
  const gl = context(t);
  gl.colorMask(0, 'x', null, {});
  gl.enable('2929'); // DEPTH_TEST as a string
  assert.equal(gl.isEnabled(gl.DEPTH_TEST), true);
  assert.equal(gl.getError(), gl.NO_ERROR);
  assert.throws(() => gl.enable(1n), TypeError);
  assert.throws(() => gl.lineWidth(Symbol('x')), TypeError);
});

test('too few arguments', (t) => {
  const gl = context(t);
  assert.throws(() => gl.viewport(0, 0, 4), TypeError);
  assert.throws(() => gl.enable(), TypeError);
  assert.throws(() => gl.isEnabled(), TypeError);
  assert.throws(() => gl.pixelStorei(gl.PACK_ALIGNMENT), TypeError);
  assert.equal(gl.getError(), gl.NO_ERROR);
});

test('state calls after destroy', () => {
  const gl = createContext({ width: 4, height: 4 });
  gl.destroy();
  assert.equal(gl.enable(gl.BLEND), undefined);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  gl.flush();
  gl.finish();
  assert.equal(gl.isEnabled(gl.BLEND), false);
  assert.equal(gl.getError(), gl.CONTEXT_LOST_WEBGL);
  assert.equal(gl.getError(), gl.NO_ERROR);
  assert.throws(() => gl.viewport(0, 0, 4), TypeError);
});

test('depth clear value', (t) => {
  const gl = context(t);
  gl.clearDepth(0.25);
  assert.equal(gl.getParameter(gl.DEPTH_CLEAR_VALUE), 0.25);
  assert.equal(gl.getError(), gl.NO_ERROR);
});

test('state is unchanged by rejected calls', (t) => {
  const gl = context(t);
  gl.blendFunc(0x1234, gl.ONE);
  expectError(gl, gl.INVALID_ENUM);
  assert.equal(gl.getParameter(gl.BLEND_SRC_RGB), gl.ONE);
  const unit = gl.getParameter(gl.ACTIVE_TEXTURE);
  gl.activeTexture(gl.TEXTURE0 + gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS));
  expectError(gl, gl.INVALID_ENUM);
  assert.equal(gl.getParameter(gl.ACTIVE_TEXTURE), unit);
  gl.depthRange(1, 0);
  expectError(gl, gl.INVALID_OPERATION);
  assert.deepEqual([...gl.getParameter(gl.DEPTH_RANGE)], [0, 1]);
  gl.scissor(0, 0, -1, 4);
  expectError(gl, gl.INVALID_VALUE);
  assert.deepEqual([...gl.getParameter(gl.SCISSOR_BOX)], [0, 0, 4, 4]);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 3);
  expectError(gl, gl.INVALID_VALUE);
  assert.equal(gl.getParameter(gl.PACK_ALIGNMENT), 4);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, 0x1234);
  expectError(gl, gl.INVALID_VALUE);
  assert.equal(gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL), gl.BROWSER_DEFAULT_WEBGL);
});

test('initial viewport and scissor box', (t) => {
  const gl = createContext({ width: 300, height: 150 });
  t.after(() => gl.destroy());
  for (const pname of [gl.VIEWPORT, gl.SCISSOR_BOX]) {
    const value = gl.getParameter(pname);
    assert.ok(value instanceof Int32Array);
    assert.deepEqual([...value], [0, 0, 300, 150]);
  }
});

test('WebGL-only unpack parameters are stored', (t) => {
  const gl = context(t);
  assert.equal(gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL), gl.BROWSER_DEFAULT_WEBGL);
  assert.equal(gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL), false);
  assert.equal(gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL), false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 5);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  assert.equal(gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL), true);
  assert.equal(gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL), gl.NONE);
  assert.equal(gl.getError(), gl.NO_ERROR);
});

test('typed-array results are new objects', (t) => {
  const gl = context(t);
  const clear = gl.getParameter(gl.COLOR_CLEAR_VALUE);
  assert.ok(clear instanceof Float32Array);
  assert.equal(clear.length, 4);
  const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  assert.ok(dims instanceof Int32Array);
  assert.equal(dims.length, 2);
  const again = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  assert.notEqual(dims, again);
  assert.deepEqual(dims, again);
  assert.ok(gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS) instanceof Uint32Array);
});

test('boolean array result', (t) => {
  const gl = context(t);
  gl.colorMask(true, false, true, false);
  assert.deepEqual(gl.getParameter(gl.COLOR_WRITEMASK), [true, false, true, false]);
});

test('unsigned mask', (t) => {
  const gl = context(t);
  const mask = gl.getParameter(gl.STENCIL_WRITEMASK);
  assert.ok(mask >= 0);
  assert.equal(mask & 0xff, 0xff);
  assert.ok(gl.getParameter(gl.STENCIL_VALUE_MASK) >= 0);
});

test('WebGL 2 parameters', (t) => {
  const gl = context(t, { webgl2: true });
  assert.ok(gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) > 0);
  assert.ok(gl.getParameter(gl.MAX_ELEMENT_INDEX) > 0);
  assert.ok(gl.getParameter(gl.MAX_SERVER_WAIT_TIMEOUT) >= 0);
  assert.equal(gl.getParameter(gl.MAX_CLIENT_WAIT_TIMEOUT_WEBGL), 0);
  assert.equal(gl.getParameter(gl.RASTERIZER_DISCARD), false);
  assert.equal(gl.getError(), gl.NO_ERROR);
});

test('unknown parameter', (t) => {
  const gl = context(t);
  assert.equal(gl.getParameter(0x1234), null);
  expectError(gl, gl.INVALID_ENUM);
});

test('WebGL 2 parameter on WebGL 1', (t) => {
  const gl = context(t);
  assert.equal(gl.getParameter(0x8073), null); // MAX_3D_TEXTURE_SIZE
  expectError(gl, gl.INVALID_ENUM);
});

test('extension parameter without the extension', (t) => {
  const gl = context(t);
  assert.equal(gl.getParameter(0x84ff), null); // MAX_TEXTURE_MAX_ANISOTROPY_EXT
  expectError(gl, gl.INVALID_ENUM);
});

test('nothing bound', (t) => {
  for (const webgl2 of [false, true]) {
    const gl = context(t, { webgl2 });
    for (const name of ['ARRAY_BUFFER_BINDING', 'CURRENT_PROGRAM', 'TEXTURE_BINDING_2D', 'FRAMEBUFFER_BINDING']) {
      assert.equal(gl.getParameter(gl[name]), null, name);
    }
    if (webgl2) {
      for (const name of ['VERTEX_ARRAY_BINDING', 'SAMPLER_BINDING', 'DRAW_FRAMEBUFFER_BINDING', 'READ_FRAMEBUFFER_BINDING']) {
        assert.equal(gl.getParameter(gl[name]), null, name);
      }
    }
    assert.equal(gl.getError(), gl.NO_ERROR);
  }
});

test('version strings', (t) => {
  const gl1 = context(t);
  assert.ok(gl1.getParameter(gl1.VERSION).startsWith('WebGL 1.0'));
  assert.ok(gl1.getParameter(gl1.SHADING_LANGUAGE_VERSION).startsWith('WebGL GLSL ES 1.0'));
  assert.equal(gl1.getParameter(gl1.VENDOR), 'oxgl');
  assert.equal(gl1.getParameter(gl1.RENDERER), 'oxgl');
  const gl2 = context(t, { webgl2: true });
  assert.ok(gl2.getParameter(gl2.VERSION).startsWith('WebGL 2.0'));
  assert.ok(gl2.getParameter(gl2.SHADING_LANGUAGE_VERSION).startsWith('WebGL GLSL ES 3.00'));
});

test('getShaderPrecisionFormat', async (t) => {
  const gl = context(t);
  const format = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  const { WebGLShaderPrecisionFormat } = await import('oxgl');
  assert.ok(format instanceof WebGLShaderPrecisionFormat);
  const all = [format.rangeMin, format.rangeMax, format.precision];
  assert.ok(
    all.every((v) => v === 0) || (format.rangeMin >= 62 && format.rangeMax >= 62 && format.precision >= 16),
    String(all),
  );
  assert.throws(() => {
    format.precision = 1;
  }, TypeError);
  assert.notEqual(gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT), format);
  assert.equal(gl.getShaderPrecisionFormat(0x1234, gl.HIGH_FLOAT), null);
  expectError(gl, gl.INVALID_ENUM);
  assert.throws(() => new WebGLShaderPrecisionFormat(), TypeError);
});

test('conversion results', (t) => {
  const gl = context(t);
  gl.colorMask(0, 'x', null, {});
  assert.deepEqual(gl.getParameter(gl.COLOR_WRITEMASK), [false, true, false, true]);
  assert.throws(() => gl.viewport(0, 0, 4), TypeError);
  assert.deepEqual([...gl.getParameter(gl.VIEWPORT)], [0, 0, 4, 4]);
  assert.throws(() => gl.getParameter(), TypeError);
});

test('queries after destroy', () => {
  const gl = createContext({ width: 4, height: 4 });
  gl.destroy();
  assert.equal(gl.getParameter(gl.VIEWPORT), null);
  assert.equal(gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT), null);
  assert.equal(gl.getError(), gl.CONTEXT_LOST_WEBGL);
  assert.equal(gl.getError(), gl.NO_ERROR);
});
