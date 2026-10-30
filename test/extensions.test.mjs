// extensions spec scenarios.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createContext } from 'oxgl';

import { program, quad, shader } from './gl-helpers.mjs';
import { readAll } from './helpers.mjs';

function pixel(gl, x, y) {
  const out = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return [...out];
}

test('supported extensions each return an object', () => {
  const gl = createContext({ width: 1, height: 1 });
  const names = gl.getSupportedExtensions();
  for (const name of ['OES_vertex_array_object', 'ANGLE_instanced_arrays', 'OES_texture_float', 'WEBGL_lose_context']) {
    assert.ok(names.includes(name), name);
  }
  assert.notEqual(gl.getSupportedExtensions(), names);
  for (const name of names) assert.equal(typeof gl.getExtension(name), 'object', name);
  assert.ok(!names.includes('EXT_color_buffer_float'));
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('WebGL 2 lists its own extensions', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  const names = gl.getSupportedExtensions();
  assert.ok(names.includes('EXT_color_buffer_float'));
  assert.ok(!names.includes('OES_vertex_array_object'));
  assert.equal(gl.getExtension('OES_vertex_array_object'), null);
  gl.destroy();
});

test('same object in any case', () => {
  const gl = createContext({ width: 1, height: 1 });
  const ext = gl.getExtension('oes_vertex_array_object');
  assert.equal(gl.getExtension('OES_vertex_array_object'), ext);
  assert.equal(ext.constructor.name, 'OES_vertex_array_object');
  assert.equal(ext.VERTEX_ARRAY_BINDING_OES, 0x85b5);
  assert.throws(() => new ext.constructor(), TypeError);
  assert.ok(Object.keys(Object.getPrototypeOf(ext)).includes('bindVertexArrayOES'));
  gl.destroy();
});

test('unknown name and missing argument', () => {
  const gl = createContext({ width: 1, height: 1 });
  assert.equal(gl.getExtension('NOT_AN_EXTENSION'), null);
  assert.equal(gl.getError(), gl.NO_ERROR);
  assert.throws(() => gl.getExtension(), TypeError);
  gl.destroy();
});

test('derivatives compile only once enabled', () => {
  const gl = createContext({ width: 1, height: 1 });
  const source =
    '#extension GL_OES_standard_derivatives : enable\nprecision mediump float; void main() { gl_FragColor = vec4(dFdx(gl_FragCoord.x)); }';
  assert.throws(() => shader(gl, gl.FRAGMENT_SHADER, source));
  const ext = gl.getExtension('OES_standard_derivatives');
  assert.ok(shader(gl, gl.FRAGMENT_SHADER, source));
  gl.hint(ext.FRAGMENT_SHADER_DERIVATIVE_HINT_OES, gl.NICEST);
  assert.equal(gl.getParameter(ext.FRAGMENT_SHADER_DERIVATIVE_HINT_OES), gl.NICEST);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('anisotropy parameters appear once enabled', () => {
  const gl = createContext({ width: 1, height: 1 });
  const MAX = 0x84ff;
  assert.equal(gl.getParameter(MAX), null);
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  const ext = gl.getExtension('EXT_texture_filter_anisotropic');
  assert.ok(gl.getParameter(MAX) >= 2);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 2);
  assert.equal(gl.getTexParameter(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT), 2);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('instanced draw on WebGL 1', () => {
  const gl = createContext({ width: 2, height: 1 });
  const ext = gl.getExtension('ANGLE_instanced_arrays');
  const p = program(
    gl,
    'attribute vec2 p; attribute float offset; void main() { gl_Position = vec4(p.x * 0.5 + offset, p.y, 0.0, 1.0); }',
    'precision mediump float; void main() { gl_FragColor = vec4(1, 0, 0, 1); }',
  );
  gl.useProgram(p);
  quad(gl, p);
  const offsets = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, offsets);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, 0.5]), gl.STATIC_DRAW);
  const location = gl.getAttribLocation(p, 'offset');
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 1, gl.FLOAT, false, 0, 0);
  ext.vertexAttribDivisorANGLE(location, 1);
  assert.equal(gl.getVertexAttrib(location, ext.VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE), 1);
  ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, 2);
  assert.deepEqual(pixel(gl, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(gl, 1, 0), [255, 0, 0, 255]);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('vertex array objects on WebGL 1', () => {
  const gl = createContext({ width: 1, height: 1 });
  const ext = gl.getExtension('OES_vertex_array_object');
  assert.equal(gl.getParameter(ext.VERTEX_ARRAY_BINDING_OES), null);
  const vao = ext.createVertexArrayOES();
  assert.equal(ext.isVertexArrayOES(vao), false);
  ext.bindVertexArrayOES(vao);
  assert.equal(ext.isVertexArrayOES(vao), true);
  assert.equal(gl.getParameter(ext.VERTEX_ARRAY_BINDING_OES), vao);
  gl.enableVertexAttribArray(0);
  ext.bindVertexArrayOES(null);
  assert.equal(gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_ENABLED), false);
  assert.equal(gl.getParameter(ext.VERTEX_ARRAY_BINDING_OES), null);
  ext.bindVertexArrayOES(vao);
  assert.equal(gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_ENABLED), true);
  ext.deleteVertexArrayOES(vao);
  assert.equal(gl.getParameter(ext.VERTEX_ARRAY_BINDING_OES), null);
  assert.equal(ext.isVertexArrayOES(vao), false);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('two color attachments on WebGL 1', () => {
  const gl = createContext({ width: 1, height: 1 });
  const ext = gl.getExtension('WEBGL_draw_buffers');
  assert.ok(gl.getParameter(ext.MAX_DRAW_BUFFERS_WEBGL) >= 2);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  const textures = [0, 1].map((i) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, ext.COLOR_ATTACHMENT0_WEBGL + i, gl.TEXTURE_2D, t, 0);
    return t;
  });
  assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
  ext.drawBuffersWEBGL([ext.COLOR_ATTACHMENT0_WEBGL, ext.COLOR_ATTACHMENT1_WEBGL]);
  const p = program(
    gl,
    'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }',
    '#extension GL_EXT_draw_buffers : require\nprecision mediump float; void main() { gl_FragData[0] = vec4(1, 0, 0, 1); gl_FragData[1] = vec4(0, 0, 1, 1); }',
  );
  gl.useProgram(p);
  quad(gl, p);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  assert.deepEqual(pixel(gl, 0, 0), [255, 0, 0, 255]);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, ext.COLOR_ATTACHMENT1_WEBGL, gl.TEXTURE_2D, null, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, ext.COLOR_ATTACHMENT0_WEBGL, gl.TEXTURE_2D, textures[1], 0);
  assert.deepEqual(pixel(gl, 0, 0), [0, 0, 255, 255]);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('float color buffers on WebGL 2', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, 1, 1);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT);
  assert.ok(gl.getExtension('EXT_color_buffer_float'));
  assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE);
  gl.clearColor(0.5, 2, -1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const out = new Float32Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
  assert.deepEqual([...out], [0.5, 2, -1, 1]);
  const rb = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA32F, 1, 1);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('debug extensions', () => {
  const gl = createContext({ width: 1, height: 1 });
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  assert.match(gl.getParameter(info.UNMASKED_RENDERER_WEBGL), /SwiftShader/);
  assert.equal(typeof gl.getParameter(info.UNMASKED_VENDOR_WEBGL), 'string');
  const shaders = gl.getExtension('WEBGL_debug_shaders');
  const s = gl.createShader(gl.VERTEX_SHADER);
  assert.equal(shaders.getTranslatedShaderSource(s), '');
  gl.shaderSource(s, 'void main() { gl_Position = vec4(0.0); }');
  gl.compileShader(s);
  // ANGLE's translation for its backend (SPIR-V on Vulkan).
  assert.ok(shaders.getTranslatedShaderSource(s).length > 0);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('parallel shader compile reports completion', () => {
  const gl = createContext({ width: 1, height: 1 });
  const ext = gl.getExtension('KHR_parallel_shader_compile');
  const p = program(gl);
  assert.equal(gl.getProgramParameter(p, ext.COMPLETION_STATUS_KHR), true);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('compressed formats follow enabled extensions', (t) => {
  const gl = createContext({ width: 1, height: 1 });
  assert.deepEqual([...gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS)], []);
  const ext = gl.getExtension('WEBGL_compressed_texture_s3tc');
  if (ext === null) {
    t.skip('no S3TC on this backend');
  } else {
    assert.ok(gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS).includes(ext.COMPRESSED_RGB_S3TC_DXT1_EXT));
  }
  gl.destroy();
});

test('multi-draw', () => {
  const gl = createContext({ width: 2, height: 1 });
  const ext = gl.getExtension('WEBGL_multi_draw');
  const p = program(gl, undefined, 'precision mediump float; void main() { gl_FragColor = vec4(0, 1, 0, 1); }');
  gl.useProgram(p);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  // A left and a right half, as two triangle pairs.
  const half = (x0, x1) => [x0, -1, x1, -1, x0, 1, x0, 1, x1, -1, x1, 1];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([...half(-1, 0), ...half(0, 1)]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  ext.multiDrawArraysWEBGL(gl.TRIANGLES, [99, 0, 6], 1, new Int32Array([6, 6]), 0, 2);
  assert.deepEqual(readAll(gl).slice(0, 8), new Uint8Array([0, 255, 0, 255, 0, 255, 0, 255]));
  ext.multiDrawArraysWEBGL(gl.TRIANGLES, [0], 0, [6], 0, -1);
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  ext.multiDrawArraysWEBGL(gl.TRIANGLES, [0], 1, [6], 0, 1);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  ext.multiDrawElementsWEBGL(gl.TRIANGLES, [6], 0, 0, [0], 0, 1);
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  gl.destroy();
});

test('extension methods do nothing once lost', () => {
  const gl = createContext({ width: 1, height: 1 });
  const ext = gl.getExtension('WEBGL_lose_context');
  const vao = gl.getExtension('OES_vertex_array_object');
  ext.loseContext();
  assert.equal(gl.isContextLost(), true);
  assert.equal(gl.getError(), gl.CONTEXT_LOST_WEBGL);
  assert.equal(gl.getExtension('OES_vertex_array_object'), null);
  assert.equal(gl.getSupportedExtensions(), null);
  vao.bindVertexArrayOES(null);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});
