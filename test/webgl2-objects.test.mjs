// webgl2-objects spec scenarios.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

import { createContext, WebGLQuery, WebGLSync, WebGLTransformFeedback, WebGLVertexArrayObject } from 'oxgl';

import { program } from './gl-helpers.mjs';
import { allPixels, readAll } from './helpers.mjs';

const VS = '#version 300 es\nin vec2 p; in vec2 offset; void main() { gl_Position = vec4(p + offset, 0.0, 1.0); }';
const FS = '#version 300 es\nprecision mediump float; out vec4 o; void main() { o = vec4(1, 0, 0, 1); }';

function context(width = 2, height = 2) {
  return createContext({ width, height, webgl2: true });
}

test('separate state per vertex array', () => {
  const gl = context();
  const a = gl.createBuffer();
  const v1 = gl.createVertexArray();
  assert.ok(v1 instanceof WebGLVertexArrayObject);
  assert.equal(gl.isVertexArray(v1), false);
  gl.bindVertexArray(v1);
  assert.equal(gl.isVertexArray(v1), true);
  gl.bindBuffer(gl.ARRAY_BUFFER, a);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const element = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, element);
  const v2 = gl.createVertexArray();
  gl.bindVertexArray(v2);
  assert.equal(gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_ENABLED), false);
  assert.equal(gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING), null);
  assert.equal(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING), null);
  gl.bindVertexArray(v1);
  assert.equal(gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_ENABLED), true);
  assert.equal(gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING), a);
  assert.equal(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING), element);
  assert.equal(gl.getParameter(gl.VERTEX_ARRAY_BINDING), v1);
  gl.deleteVertexArray(v1);
  assert.equal(gl.getParameter(gl.VERTEX_ARRAY_BINDING), null);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('per-instance offsets', () => {
  const gl = context(2, 1);
  const p = program(gl, VS, FS);
  gl.useProgram(p);
  gl.bindVertexArray(gl.createVertexArray());
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  // A quad over the left half of clip space.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, -1, -1, 1, -1, 1, 0, -1, 0, 1]), gl.STATIC_DRAW);
  const location = gl.getAttribLocation(p, 'p');
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0]), gl.STATIC_DRAW);
  const offset = gl.getAttribLocation(p, 'offset');
  gl.enableVertexAttribArray(offset);
  gl.vertexAttribPointer(offset, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(offset, 1);
  assert.equal(gl.getVertexAttrib(offset, gl.VERTEX_ATTRIB_ARRAY_DIVISOR), 1);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 2);
  assert.ok(allPixels(readAll(gl), [255, 0, 0, 255]));
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array([0, 1, 2, 3, 4, 5]), gl.STATIC_DRAW);
  gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_BYTE, 0, 2);
  assert.ok(allPixels(readAll(gl), [255, 0, 0, 255]));
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

const BLOCK_FS = `#version 300 es
precision mediump float; uniform B { vec4 color; }; out vec4 o; void main() { o = color; }`;
const PLAIN_VS = '#version 300 es\nin vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';

test('uniform block drives a color, and introspection', () => {
  const gl = context();
  const p = program(gl, PLAIN_VS, BLOCK_FS);
  gl.useProgram(p);
  assert.equal(gl.getUniformBlockIndex(p, 'B'), 0);
  assert.equal(gl.getUniformBlockIndex(p, 'missing'), gl.INVALID_INDEX);
  assert.equal(gl.getActiveUniformBlockName(p, 0), 'B');
  const indices = gl.getActiveUniformBlockParameter(p, 0, gl.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES);
  assert.ok(indices instanceof Uint32Array && indices.length === 1);
  assert.equal(gl.getActiveUniformBlockParameter(p, 0, gl.UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER), true);
  assert.deepEqual(gl.getUniformIndices(p, ['color']), [indices[0]]);
  assert.deepEqual(gl.getActiveUniforms(p, [indices[0]], gl.UNIFORM_TYPE), [gl.FLOAT_VEC4]);
  assert.deepEqual(gl.getActiveUniforms(p, [indices[0]], gl.UNIFORM_IS_ROW_MAJOR), [false]);
  gl.uniformBlockBinding(p, 0, 1);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
  gl.bufferData(gl.UNIFORM_BUFFER, new Float32Array([0, 1, 0, 1]), gl.STATIC_DRAW);
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 1, buffer);
  assert.equal(gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING, 1), buffer);
  assert.equal(gl.getIndexedParameter(gl.UNIFORM_BUFFER_SIZE, 1), 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  assert.ok(allPixels(readAll(gl), [0, 255, 0, 255]));
  gl.bindBufferRange(gl.UNIFORM_BUFFER, 2, buffer, 0, 16);
  assert.equal(gl.getIndexedParameter(gl.UNIFORM_BUFFER_SIZE, 2), 16);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('capture vertex outputs with transform feedback', () => {
  const gl = context();
  const vs = '#version 300 es\nin float x; out float v; void main() { v = x * 2.0; gl_Position = vec4(0); gl_PointSize = 1.0; }';
  const fs = '#version 300 es\nprecision mediump float; out vec4 o; void main() { o = vec4(1); }';
  const p = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    gl.attachShader(p, s);
  }
  gl.transformFeedbackVaryings(p, ['v'], gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(p);
  assert.equal(gl.getProgramParameter(p, gl.LINK_STATUS), true, gl.getProgramInfoLog(p));
  const varying = gl.getTransformFeedbackVarying(p, 0);
  assert.deepEqual([varying.name, varying.type, varying.size], ['v', gl.FLOAT, 1]);
  gl.useProgram(p);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([1, 2, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 0, 0);
  const feedback = gl.createTransformFeedback();
  assert.ok(feedback instanceof WebGLTransformFeedback);
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback);
  assert.equal(gl.getParameter(gl.TRANSFORM_FEEDBACK_BINDING), feedback);
  const out = gl.createBuffer();
  gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, out);
  gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, 12, gl.STATIC_READ);
  gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, out);
  assert.equal(gl.getIndexedParameter(gl.TRANSFORM_FEEDBACK_BUFFER_BINDING, 0), out);
  gl.enable(gl.RASTERIZER_DISCARD);
  gl.beginTransformFeedback(gl.POINTS);
  gl.drawArrays(gl.POINTS, 0, 3);
  gl.deleteTransformFeedback(feedback);
  assert.equal(gl.getError(), gl.INVALID_OPERATION, 'an active transform feedback is not deleted');
  assert.equal(gl.isTransformFeedback(feedback), true);
  gl.endTransformFeedback();
  gl.disable(gl.RASTERIZER_DISCARD);
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
  assert.equal(gl.getIndexedParameter(gl.TRANSFORM_FEEDBACK_BUFFER_BINDING, 0), null);
  gl.bindBuffer(gl.COPY_READ_BUFFER, out);
  const result = new Float32Array(3);
  gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, result);
  assert.deepEqual([...result], [2, 4, 6]);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('query result after a turn', async () => {
  const gl = context();
  gl.useProgram(program(gl, PLAIN_VS, FS));
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const query = gl.createQuery();
  assert.ok(query instanceof WebGLQuery);
  gl.beginQuery(gl.ANY_SAMPLES_PASSED, query);
  assert.equal(gl.getQuery(gl.ANY_SAMPLES_PASSED, gl.CURRENT_QUERY), query);
  assert.equal(gl.isQuery(query), true);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.endQuery(gl.ANY_SAMPLES_PASSED);
  assert.equal(gl.getQuery(gl.ANY_SAMPLES_PASSED, gl.CURRENT_QUERY), null);
  assert.equal(gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE), false, 'not within the same turn');
  // Like an application, poll once per turn until the GPU has the result.
  let available = false;
  for (let turn = 0; turn < 200 && !available; turn++) {
    await delay(5);
    available = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
  }
  assert.equal(available, true);
  assert.equal(gl.getQueryParameter(query, gl.QUERY_RESULT), 1);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('sync signaled after a turn', async () => {
  const gl = context();
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  assert.ok(sync instanceof WebGLSync);
  assert.equal(gl.isSync(sync), true);
  assert.equal(gl.getSyncParameter(sync, gl.SYNC_STATUS), gl.UNSIGNALED);
  assert.equal(gl.clientWaitSync(sync, 0, 0), gl.TIMEOUT_EXPIRED);
  gl.clientWaitSync(sync, 0, 1);
  assert.equal(gl.getError(), gl.INVALID_VALUE, 'timeouts above MAX_CLIENT_WAIT_TIMEOUT_WEBGL');
  await delay(5);
  gl.finish();
  assert.equal(gl.getSyncParameter(sync, gl.SYNC_STATUS), gl.SIGNALED);
  assert.ok([gl.ALREADY_SIGNALED, gl.CONDITION_SATISFIED].includes(gl.clientWaitSync(sync, 0, 0)));
  gl.waitSync(sync, 0, gl.TIMEOUT_IGNORED);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.deleteSync(sync);
  assert.equal(gl.isSync(sync), false);
  gl.destroy();
});
