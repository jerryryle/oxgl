// context-loss spec scenarios.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

import { createContext, WebGLContextEvent } from 'oxgl';

import { program, quad, color } from './gl-helpers.mjs';
import { allPixels, readAll } from './helpers.mjs';

test('lost event after loseContext', async () => {
  const gl = createContext({ width: 1, height: 1 });
  const ext = gl.getExtension('WEBGL_lose_context');
  let fired = 0;
  gl.canvas.addEventListener('webglcontextlost', (event) => {
    assert.ok(event instanceof WebGLContextEvent);
    assert.equal(event.statusMessage, '');
    assert.equal(event.cancelable, true);
    assert.equal(gl.isContextLost(), true);
    fired += 1;
  });
  const linked = program(gl);
  ext.loseContext();
  assert.equal(gl.isContextLost(), true);
  assert.equal(gl.getError(), gl.CONTEXT_LOST_WEBGL);
  assert.equal(gl.getError(), gl.NO_ERROR);
  assert.equal(gl.getAttachedShaders(linked), null);
  gl.blendFunc(gl.TEXTURE_2D, gl.TEXTURE_CUBE_MAP);
  assert.equal(gl.getError(), gl.NO_ERROR);
  assert.equal(fired, 0);
  await delay(0);
  assert.equal(fired, 1);
  ext.loseContext();
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
});

test('no restore without cancelling', async () => {
  const gl = createContext({ width: 1, height: 1 });
  const ext = gl.getExtension('WEBGL_lose_context');
  let restored = false;
  gl.canvas.addEventListener('webglcontextrestored', () => {
    restored = true;
  });
  ext.loseContext();
  await once(gl.canvas, 'webglcontextlost');
  gl.getError();
  ext.restoreContext();
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  await delay(5);
  assert.equal(restored, false);
  assert.equal(gl.isContextLost(), true);
  gl.destroy();
});

test('restoreContext on a live context', () => {
  const gl = createContext({ width: 1, height: 1 });
  gl.getExtension('WEBGL_lose_context').restoreContext();
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  gl.destroy();
});

test('restore after a cancelled event', async () => {
  const gl = createContext({ width: 2, height: 2 });
  const lose = gl.getExtension('WEBGL_lose_context');
  const vaoExt = gl.getExtension('OES_vertex_array_object');
  const texture = gl.createTexture();
  gl.canvas.addEventListener('webglcontextlost', (event) => event.preventDefault());
  lose.loseContext();
  await once(gl.canvas, 'webglcontextlost');
  assert.equal(gl.getError(), gl.CONTEXT_LOST_WEBGL);
  lose.restoreContext();
  lose.restoreContext();
  assert.equal(gl.getError(), gl.NO_ERROR);
  assert.equal(gl.isContextLost(), true);
  await once(gl.canvas, 'webglcontextrestored');
  assert.equal(gl.isContextLost(), false);
  assert.equal(gl.getError(), gl.NO_ERROR);
  assert.equal(gl.drawingBufferWidth, 2);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  assert.equal(gl.getError(), gl.INVALID_OPERATION);
  const p = program(gl);
  gl.useProgram(p);
  quad(gl, p);
  color(gl, p, [0, 1, 0, 1]);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  assert.ok(allPixels(readAll(gl), [0, 255, 0, 255]));
  assert.equal(gl.getExtension('WEBGL_lose_context'), lose);
  const newVaoExt = gl.getExtension('OES_vertex_array_object');
  assert.notEqual(newVaoExt, vaoExt);
  const old = vaoExt.createVertexArrayOES();
  assert.ok(old);
  assert.equal(vaoExt.isVertexArrayOES(old), false);
  // The same WEBGL_lose_context object loses the restored context.
  lose.loseContext();
  assert.equal(gl.isContextLost(), true);
  gl.destroy();
});

test('WebGLContextEvent', () => {
  const event = new WebGLContextEvent('webglcontextlost', { statusMessage: 'x', cancelable: true });
  assert.equal(event.type, 'webglcontextlost');
  assert.equal(event.statusMessage, 'x');
  assert.equal(event.cancelable, true);
  assert.equal(new WebGLContextEvent('webglcontextrestored').statusMessage, '');
  assert.throws(() => new WebGLContextEvent(), TypeError);
});

test('destroy fires no lost event', async () => {
  const gl = createContext({ width: 1, height: 1 });
  let fired = false;
  gl.canvas.addEventListener('webglcontextlost', () => {
    fired = true;
  });
  gl.destroy();
  assert.equal(gl.isContextLost(), true);
  await delay(0);
  assert.equal(fired, false);
});
