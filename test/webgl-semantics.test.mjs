// conformance-gaps spec scenarios: WebGL behavior Chromium implements on top
// of GL.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createContext } from 'oxgl';

import { program } from './gl-helpers.mjs';

test('texture calls need a bound texture', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  // An invalid target is still INVALID_ENUM.
  gl.texStorage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X, 1, gl.RGBA8, 1, 1);
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  gl.destroy();
});

test('texture swizzle is not a WebGL parameter', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, 0x8e42 /* TEXTURE_SWIZZLE_R */, gl.RED);
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  assert.equal(gl.getTexParameter(gl.TEXTURE_2D, 0x8e42), null);
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  gl.destroy();
});

test('locations need a linked program', () => {
  const gl = createContext({ width: 1, height: 1 });
  const unlinked = gl.createProgram();
  assert.equal(gl.getAttribLocation(unlinked, 'webgl_reserved'), -1);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  assert.equal(gl.getUniformLocation(unlinked, 'c'), null);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  assert.notEqual(gl.getUniformLocation(program(gl), 'c'), null);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('WebGL 2 restarts primitives and cannot toggle it', () => {
  const gl = createContext({ width: 2, height: 1, webgl2: true, attributes: { antialias: false } });
  gl.enable(gl.PRIMITIVE_RESTART_FIXED_INDEX ?? 0x8d69);
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  assert.equal(gl.isEnabled(0x8d69), false);
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  gl.useProgram(program(gl, '#version 300 es\nin vec2 p; void main() { gl_Position = vec4(p, 0, 1); }', '#version 300 es\nprecision mediump float; out vec4 o; void main() { o = vec4(1, 0, 0, 1); }'));
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  // Left half: a strip; then the restart index; then a degenerate strip.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, -1, -1, 1, 0, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  // Without restart, 3-0xffff-... would draw the right half too.
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 3, 0xffff, 4, 5, 4]), gl.STATIC_DRAW);
  gl.drawElements(gl.TRIANGLE_STRIP, 8, gl.UNSIGNED_SHORT, 0);
  const out = new Uint8Array(8);
  gl.readPixels(0, 0, 2, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  assert.deepEqual([...out], [255, 0, 0, 255, 0, 0, 0, 0]);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('integer TexImageSource uploads are premultiplied', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  const image = { width: 2, height: 1, data: new Uint8ClampedArray([200, 0, 0, 255, 200, 0, 0, 0]) };
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, image);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gl.getParameter(gl.TEXTURE_BINDING_2D), 0);
  const out = new Uint32Array(8);
  gl.readPixels(0, 0, 2, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, out);
  assert.deepEqual([out[0], out[4]], [200, 0]);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('getUniform over every element of a large array', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  const p = program(
    gl,
    '#version 300 es\nin vec2 p; void main() { gl_Position = vec4(p, 0, 1); }',
    '#version 300 es\nprecision mediump float; uniform vec4 u[200]; uniform int k; out vec4 o; void main() { o = u[k]; }',
  );
  gl.useProgram(p);
  const start = performance.now();
  for (let i = 0; i < 200; i++) {
    const location = gl.getUniformLocation(p, `u[${String(i)}]`);
    gl.uniform4f(location, i, 0, 0, 1);
    assert.equal(gl.getUniform(p, location)[0], i);
  }
  // One pass maps the program's locations; the reads stay linear.
  assert.ok(performance.now() - start < 2000);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('query and pointer details', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  const never = gl.createQuery();
  assert.equal(gl.getQueryParameter(never, gl.QUERY_RESULT_AVAILABLE), null);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  const active = gl.createQuery();
  gl.beginQuery(gl.TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN, active);
  gl.deleteQuery(active);
  gl.beginQuery(gl.TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN, gl.createQuery());
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.vertexAttribIPointer(0, 1, gl.INT, 0, 4);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.bindRenderbuffer(gl.RENDERBUFFER, gl.createRenderbuffer());
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 1, gl.DEPTH_STENCIL, 1, 1);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.destroy();
});

test('WebGL 1 depth textures and DEPTH_STENCIL_ATTACHMENT', () => {
  const gl = createContext({ width: 1, height: 1 });
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, 1, 1, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  gl.getExtension('WEBGL_depth_texture');
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, 1, 1, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, new Uint16Array(1));
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, 1, 1, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  const rb = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, 1, 1);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, rb);
  assert.equal(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME), rb);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});
