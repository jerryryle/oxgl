// shaders-programs spec scenarios.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createContext, WebGLActiveInfo } from 'oxgl';

import { FRAGMENT, program, shader, VERTEX } from './gl-helpers.mjs';

test('compile status and log', () => {
  const gl = createContext({ width: 1, height: 1 });
  const s = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(s, 'void main() { gl_Position = vec4(0.0) }');
  gl.compileShader(s);
  assert.equal(gl.getShaderParameter(s, gl.COMPILE_STATUS), false);
  assert.ok(gl.getShaderInfoLog(s).length > 0);
  gl.destroy();
});

test('valid shader and its parameters', () => {
  const gl = createContext({ width: 1, height: 1 });
  const s = shader(gl, gl.VERTEX_SHADER, 'void main() { gl_Position = vec4(0.0); }');
  assert.equal(gl.getShaderParameter(s, gl.COMPILE_STATUS), true);
  assert.equal(gl.getShaderParameter(s, gl.SHADER_TYPE), gl.VERTEX_SHADER);
  assert.equal(gl.getShaderParameter(s, gl.DELETE_STATUS), false);
  assert.equal(gl.getShaderParameter(s, gl.INFO_LOG_LENGTH), null, 'not a WebGL parameter');
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  gl.destroy();
});

test('source round trip', () => {
  const gl = createContext({ width: 1, height: 1 });
  const s = gl.createShader(gl.FRAGMENT_SHADER);
  assert.equal(gl.getShaderSource(s), '');
  const text = '// é not GLSL \n void main() {}';
  gl.shaderSource(s, text);
  assert.equal(gl.getShaderSource(s), text);
  gl.destroy();
});

test('invalid shader type', () => {
  const gl = createContext({ width: 1, height: 1 });
  assert.equal(gl.createShader(0x1234), null);
  assert.equal(gl.getError(), gl.INVALID_ENUM);
  gl.destroy();
});

test('link and use', () => {
  for (const webgl2 of [false, true]) {
    const gl = createContext({ width: 1, height: 1, webgl2 });
    const vs = shader(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    assert.equal(gl.getProgramParameter(p, gl.LINK_STATUS), true);
    assert.equal(gl.getProgramParameter(p, gl.ATTACHED_SHADERS), 2);
    assert.deepEqual(new Set(gl.getAttachedShaders(p)), new Set([vs, fs]));
    gl.useProgram(p);
    assert.equal(gl.getParameter(gl.CURRENT_PROGRAM), p);
    gl.validateProgram(p);
    assert.equal(gl.getProgramParameter(p, gl.VALIDATE_STATUS), true);
    assert.equal(gl.getError(), gl.NO_ERROR);
    gl.destroy();
  }
});

test('attachment rules', () => {
  const gl = createContext({ width: 1, height: 1 });
  const p = gl.createProgram();
  const vs = shader(gl, gl.VERTEX_SHADER, VERTEX);
  gl.attachShader(p, vs);
  gl.attachShader(p, vs);
  assert.equal(gl.getError(), gl.INVALID_OPERATION, 'attached twice');
  gl.attachShader(p, shader(gl, gl.VERTEX_SHADER, VERTEX));
  assert.equal(gl.getError(), gl.INVALID_OPERATION, 'second vertex shader');
  gl.detachShader(p, shader(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  assert.equal(gl.getError(), gl.INVALID_OPERATION, 'not attached');
  gl.detachShader(p, vs);
  assert.deepEqual(gl.getAttachedShaders(p), []);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('link failure', () => {
  const gl = createContext({ width: 1, height: 1 });
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl, gl.VERTEX_SHADER, VERTEX));
  gl.linkProgram(p);
  assert.equal(gl.getProgramParameter(p, gl.LINK_STATUS), false);
  gl.useProgram(p);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  assert.equal(gl.getParameter(gl.CURRENT_PROGRAM), null);
  gl.destroy();
});

test('deleted shader still attached', () => {
  const gl = createContext({ width: 1, height: 1 });
  const p = gl.createProgram();
  const vs = shader(gl, gl.VERTEX_SHADER, VERTEX);
  gl.attachShader(p, vs);
  gl.attachShader(p, shader(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.deleteShader(vs);
  assert.equal(gl.isShader(vs), false);
  assert.ok(gl.getAttachedShaders(p).includes(vs));
  gl.linkProgram(p);
  assert.equal(gl.getProgramParameter(p, gl.LINK_STATUS), true);
  gl.compileShader(vs);
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  gl.destroy();
});

test('active uniform and attribute', () => {
  const gl = createContext({ width: 1, height: 1 });
  const p = program(gl);
  const uniform = gl.getActiveUniform(p, 0);
  assert.ok(uniform instanceof WebGLActiveInfo);
  assert.deepEqual([uniform.name, uniform.type, uniform.size], ['c', gl.FLOAT_VEC4, 1]);
  const attrib = gl.getActiveAttrib(p, 0);
  assert.deepEqual([attrib.name, attrib.type, attrib.size], ['p', gl.FLOAT_VEC2, 1]);
  assert.equal(gl.getActiveUniform(p, 1), null);
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  gl.destroy();
});

test('name rules', () => {
  const gl = createContext({ width: 1, height: 1 });
  const p = program(gl);
  assert.equal(gl.getAttribLocation(p, 'a'.repeat(257)), -1);
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  assert.equal(gl.getUniformLocation(p, 'webgl_x'), null);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.bindAttribLocation(p, 0, 'webgl_x');
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.bindAttribLocation(p, 3, 'p');
  gl.linkProgram(p);
  assert.equal(gl.getAttribLocation(p, 'p'), 3);
  gl.destroy();
});

const UNIFORMS = `precision mediump float;
uniform vec4 v4; uniform float f[3]; uniform bool b; uniform bvec2 b2; uniform sampler2D s;
uniform mat2 m2; uniform ivec3 i3;
void main() { gl_FragColor = v4 + vec4(f[2]) + vec4(b ? 1.0 : 0.0) + vec4(b2.y ? 1.0 : 0.0)
  + texture2D(s, vec2(0.0)) + vec4(m2[1], 0.0, 0.0) + vec4(i3.z); }`;

test('set and get uniforms', () => {
  const gl = createContext({ width: 1, height: 1 });
  const p = program(gl, undefined, UNIFORMS);
  gl.useProgram(p);
  const at = (name) => gl.getUniformLocation(p, name);
  gl.uniform4fv(at('v4'), [1, 2, 3, 4]);
  assert.deepEqual(gl.getUniform(p, at('v4')), new Float32Array([1, 2, 3, 4]));
  gl.uniform1fv(at('f'), new Float32Array([5, 6, 7]));
  assert.equal(gl.getUniform(p, at('f[2]')), 7);
  assert.equal(gl.getUniform(p, at('f[0]')), 5);
  gl.uniform1i(at('b'), 2);
  assert.equal(gl.getUniform(p, at('b')), true);
  gl.uniform2i(at('b2'), 0, 1);
  assert.deepEqual(gl.getUniform(p, at('b2')), [false, true]);
  gl.uniform1i(at('s'), 3);
  assert.equal(gl.getUniform(p, at('s')), 3);
  gl.uniformMatrix2fv(at('m2'), false, [1, 2, 3, 4]);
  assert.deepEqual(gl.getUniform(p, at('m2')), new Float32Array([1, 2, 3, 4]));
  gl.uniform3iv(at('i3'), [7, 8, 9]);
  assert.deepEqual(gl.getUniform(p, at('i3')), new Int32Array([7, 8, 9]));
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('location of another program, of an earlier link, null location', () => {
  const gl = createContext({ width: 1, height: 1 });
  const a = program(gl);
  const b = program(gl);
  const location = gl.getUniformLocation(a, 'c');
  gl.useProgram(b);
  gl.uniform4f(location, 1, 1, 1, 1);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.useProgram(a);
  gl.linkProgram(a);
  gl.uniform4f(location, 1, 1, 1, 1);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.uniform4f(null, 1, 1, 1, 1);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('bad array lengths', () => {
  const gl = createContext({ width: 1, height: 1 });
  const p = program(gl, undefined, 'precision mediump float; uniform vec3 v; void main() { gl_FragColor = vec4(v, 1.0); }');
  gl.useProgram(p);
  const location = gl.getUniformLocation(p, 'v');
  gl.uniform3fv(location, [1, 2, 3, 4]);
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  gl.uniform3fv(location, []);
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  gl.uniformMatrix3fv(location, true, new Float32Array(9));
  assert.notEqual(gl.getError(), gl.NO_ERROR, 'transpose is invalid on WebGL 1');
  gl.destroy();
});

test('WebGL 2 unsigned, non-square and offset forms', () => {
  const gl = createContext({ width: 1, height: 1, webgl2: true });
  const fragment = `#version 300 es
precision mediump float; uniform uvec2 u; uniform mat2x3 m; uniform vec2 v; out vec4 o;
void main() { o = vec4(vec2(u), v) + vec4(m[1], 0.0); }`;
  const vertex = '#version 300 es\nin vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';
  const p = program(gl, vertex, fragment);
  gl.useProgram(p);
  gl.uniform2ui(gl.getUniformLocation(p, 'u'), 4, 5);
  assert.deepEqual(gl.getUniform(p, gl.getUniformLocation(p, 'u')), new Uint32Array([4, 5]));
  gl.uniformMatrix2x3fv(gl.getUniformLocation(p, 'm'), false, [9, 1, 2, 3, 4, 5, 6, 9], 1, 6);
  assert.deepEqual(gl.getUniform(p, gl.getUniformLocation(p, 'm')), new Float32Array([1, 2, 3, 4, 5, 6]));
  gl.uniform2fv(gl.getUniformLocation(p, 'v'), [0, 7, 8], 1);
  assert.deepEqual(gl.getUniform(p, gl.getUniformLocation(p, 'v')), new Float32Array([7, 8]));
  gl.uniform2fv(gl.getUniformLocation(p, 'v'), [0, 7, 8], 2, 2);
  assert.equal(gl.getError(), gl.INVALID_VALUE);
  assert.equal(gl.getFragDataLocation(p, 'o'), 0);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});
