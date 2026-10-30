// framebuffers spec scenarios, and the framebuffer parts of context-state
// and pixel-readback.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createContext, WebGLFramebuffer, WebGLRenderbuffer } from 'oxgl';

import { program } from './gl-helpers.mjs';
import { allPixels, readAll } from './helpers.mjs';

const VS = 'attribute vec2 p; varying vec2 v; void main() { v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
const FS = 'precision mediump float; uniform sampler2D t; varying vec2 v; void main() { gl_FragColor = texture2D(t, v); }';

function pixel(gl, x = 0, y = 0) {
  const out = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return [...out];
}

function colorTexture(gl, width = 2, height = 2) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return texture;
}

test('render to a texture', () => {
  for (const webgl2 of [false, true]) {
    const gl = createContext({ width: 2, height: 2, webgl2 });
    const texture = colorTexture(gl);
    const framebuffer = gl.createFramebuffer();
    assert.ok(framebuffer instanceof WebGLFramebuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
    gl.clearColor(0, 0, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    assert.deepEqual(pixel(gl), [0, 0, 255, 255], 'reads the framebuffer object');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    assert.deepEqual(pixel(gl), [0, 0, 0, 0], 'the drawing buffer is unchanged');
    gl.useProgram(program(gl, VS, FS));
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    assert.ok(allPixels(readAll(gl), [0, 0, 255, 255]));
    assert.equal(gl.getError(), gl.NO_ERROR);
    gl.destroy();
  }
});

test('renderbuffer storage and parameters', () => {
  const gl = createContext({ width: 1, height: 1 });
  const renderbuffer = gl.createRenderbuffer();
  assert.ok(renderbuffer instanceof WebGLRenderbuffer);
  assert.equal(gl.isRenderbuffer(renderbuffer), false);
  gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
  assert.equal(gl.isRenderbuffer(renderbuffer), true);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA4, 3, 5);
  assert.equal(gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_WIDTH), 3);
  assert.equal(gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_HEIGHT), 5);
  assert.equal(gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_INTERNAL_FORMAT), gl.RGBA4);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, 3, 5);
  assert.equal(gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_INTERNAL_FORMAT), gl.DEPTH_STENCIL);
  assert.equal(gl.getParameter(gl.RENDERBUFFER_BINDING), renderbuffer);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('unbind, and deleting the bound framebuffer', () => {
  const gl = createContext({ width: 1, height: 1 });
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  assert.equal(gl.getParameter(gl.FRAMEBUFFER_BINDING), framebuffer);
  assert.equal(gl.isFramebuffer(framebuffer), true);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  assert.equal(gl.getParameter(gl.FRAMEBUFFER_BINDING), null);
  gl.clearColor(1, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  assert.deepEqual(pixel(gl), [255, 0, 0, 255]);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.deleteFramebuffer(framebuffer);
  assert.equal(gl.getParameter(gl.FRAMEBUFFER_BINDING), null);
  gl.clearColor(0, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  assert.deepEqual(pixel(gl), [0, 255, 0, 255]);
  assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('default draw and read buffers (WebGL 2)', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.drawBuffers([gl.NONE]);
  assert.equal(gl.getParameter(gl.DRAW_BUFFER0), gl.NONE);
  gl.drawBuffers([gl.BACK]);
  assert.equal(gl.getParameter(gl.DRAW_BUFFER0), gl.BACK);
  gl.readBuffer(gl.NONE);
  assert.equal(gl.getParameter(gl.READ_BUFFER), gl.NONE);
  gl.readBuffer(gl.BACK);
  assert.equal(gl.getError(), gl.NO_ERROR);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  assert.equal(gl.getParameter(gl.DRAW_BUFFER0), gl.COLOR_ATTACHMENT0);
  assert.equal(gl.getParameter(gl.READ_BUFFER), gl.COLOR_ATTACHMENT0);
  gl.destroy();
});

test('WebGL 1 lists', () => {
  const gl = createContext({ width: 1, height: 1 });
  gl.bindRenderbuffer(gl.RENDERBUFFER, gl.createRenderbuffer());
  gl.renderbufferStorage(gl.RENDERBUFFER, 0x8058 /* RGBA8 */, 1, 1);
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  gl.bindFramebuffer(0x8ca8 /* READ_FRAMEBUFFER */, null);
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, 0x8ce1 /* COLOR_ATTACHMENT1 */, gl.RENDERBUFFER, null);
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  gl.destroy();
});

test('depth-stencil attachment', () => {
  const gl = createContext({ width: 1, height: 1 });
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  const color = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, color);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA4, 4, 4);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
  const depthStencil = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depthStencil);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, 4, 4);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depthStencil);
  assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('attachment queries and deleted attachments', () => {
  const gl = createContext({ width: 1, height: 1 });
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  const renderbuffer = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 1, 1);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer);
  const query = (pname) => gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, pname);
  assert.equal(query(gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME), renderbuffer);
  assert.equal(query(gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE), gl.RENDERBUFFER);
  gl.deleteRenderbuffer(renderbuffer);
  assert.equal(query(gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE), gl.NONE);
  assert.equal(query(gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME), null);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  assert.equal(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE), null);
  assert.equal(gl.getError(), gl.INVALID_OPERATION, 'framebuffer 0 has no attachment queries on WebGL 1');
  gl.destroy();
});

test('depth-stencil query with different objects, and readBuffer(NONE)', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  gl.readBuffer(gl.NONE);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.readBuffer(gl.BACK);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  const depth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 1, 1);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  const stencil = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, stencil);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.STENCIL_INDEX8, 1, 1);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.STENCIL_ATTACHMENT, gl.RENDERBUFFER, stencil);
  const name = gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME);
  assert.equal(name, null);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.destroy();
});

test('default framebuffer attachment queries (WebGL 2)', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true, attributes: { stencil: false } });
  const query = (attachment, pname) => gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, attachment, pname);
  assert.equal(query(gl.BACK, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE), gl.FRAMEBUFFER_DEFAULT);
  assert.equal(query(gl.BACK, gl.FRAMEBUFFER_ATTACHMENT_RED_SIZE), 8);
  assert.equal(query(gl.DEPTH, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE), gl.FRAMEBUFFER_DEFAULT);
  assert.ok(query(gl.DEPTH, gl.FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE) >= 16);
  assert.equal(query(gl.STENCIL, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE), gl.NONE);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('multisampled render target resolved by a blit', () => {
  const gl = createContext({ width: 4, height: 4, webgl2: true });
  const msaa = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, msaa);
  const renderbuffer = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.RGBA8, 4, 4);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, renderbuffer);
  gl.clearColor(1, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const resolved = gl.createFramebuffer();
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolved);
  gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTexture(gl, 4, 4), 0);
  gl.blitFramebuffer(0, 0, 4, 4, 0, 0, 4, 4, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, resolved);
  assert.equal(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), resolved);
  assert.deepEqual(pixel(gl), [255, 0, 0, 255]);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('blit from the antialiased drawing buffer', () => {
  const gl = createContext({ width: 4, height: 4, webgl2: true });
  gl.clearColor(0, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const target = gl.createFramebuffer();
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target);
  gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTexture(gl, 4, 4), 0);
  gl.blitFramebuffer(0, 0, 4, 4, 0, 0, 4, 4, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target);
  assert.deepEqual(pixel(gl), [0, 255, 0, 255]);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('multiple render targets', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  const fs = `#version 300 es
precision mediump float; layout(location = 0) out vec4 a; layout(location = 1) out vec4 b;
void main() { a = vec4(1, 0, 0, 1); b = vec4(0, 1, 0, 1); }`;
  const vs = '#version 300 es\nin vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';
  gl.useProgram(program(gl, vs, fs));
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTexture(gl, 1, 1), 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, colorTexture(gl, 1, 1), 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  assert.deepEqual(pixel(gl), [255, 0, 0, 255]);
  gl.readBuffer(gl.COLOR_ATTACHMENT1);
  assert.deepEqual(pixel(gl), [0, 255, 0, 255]);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('clear one buffer, invalidate, sample counts', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  gl.clearBufferfv(gl.COLOR, 0, [0, 1, 0, 1]);
  assert.deepEqual(pixel(gl), [0, 255, 0, 255]);
  gl.clearBufferfv(gl.COLOR, 0, [0, 1, 0]);
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  gl.clearBufferfi(gl.DEPTH_STENCIL, 0, 1, 0);
  gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.COLOR, gl.DEPTH]);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.COLOR_ATTACHMENT0]);
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  const samples = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA8, gl.SAMPLES);
  assert.ok(samples instanceof Int32Array && samples.length > 0);
  assert.ok([...samples].every((n, i) => i === 0 || n < samples[i - 1]));
  gl.destroy();
});

test('read into a pack buffer, and mismatched overloads', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  gl.clearColor(1, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0);
  assert.equal(gl.getError(), gl.INVALID_OPERATION, 'no pack buffer bound');
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, 4, gl.STREAM_READ);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  assert.equal(gl.getError(), gl.INVALID_OPERATION, 'a view while a pack buffer is bound');
  const out = new Uint8Array(4);
  gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
  assert.deepEqual([...out], [255, 0, 0, 255]);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const offset = new Uint8Array(8);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, offset, 4);
  assert.deepEqual([...offset], [0, 0, 0, 0, 255, 0, 0, 255]);
  gl.destroy();
});
