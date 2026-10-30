import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import { loadNative } from '../dist/load-native.js';

test('ESM import loads the native addon', async () => {
  const oxgl = await import('oxgl');
  assert.equal(oxgl.nativeAbiVersion, 9);
});

test('CommonJS require returns the same exports as import', async () => {
  const required = createRequire(import.meta.url)('oxgl');
  const imported = await import('oxgl');
  assert.equal(required.nativeAbiVersion, imported.nativeAbiVersion);
});

test('a missing addon throws OXGL_NATIVE_MISSING naming platform and arch', () => {
  assert.throws(
    () => loadNative('./does-not-exist.cjs', import.meta.url),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.code, 'OXGL_NATIVE_MISSING');
      assert.match(error.message, new RegExp(`${process.platform}-${process.arch}`));
      assert.ok(error.cause instanceof Error, 'original load error is kept as cause');
      return true;
    },
  );
});
