// extensions spec scenarios: the extension query surface.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createContext } from 'oxgl';

test('no extensions yet', (t) => {
  for (const webgl2 of [false, true]) {
    const gl = createContext({ width: 4, height: 4, webgl2 });
    t.after(() => gl.destroy());
    const names = gl.getSupportedExtensions();
    assert.deepEqual(names, []);
    assert.notEqual(gl.getSupportedExtensions(), names);
    assert.equal(gl.getExtension('OES_texture_float'), null);
    assert.equal(gl.getError(), gl.NO_ERROR);
  }
});

test('missing argument', (t) => {
  const gl = createContext({ width: 4, height: 4 });
  t.after(() => gl.destroy());
  assert.throws(() => gl.getExtension(), TypeError);
  assert.throws(() => gl.getExtension(Symbol('x')), TypeError);
});

test('extension queries after destroy', () => {
  const gl = createContext({ width: 4, height: 4 });
  gl.destroy();
  assert.equal(gl.getSupportedExtensions(), null);
  assert.equal(gl.getExtension('OES_texture_float'), null);
});
