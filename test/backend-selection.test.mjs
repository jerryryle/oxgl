// backend-selection spec scenarios. Which backend rendered is not observable
// from JS; the Rust tests (oxgl-core backend.rs) cover selection order, the
// CPU-renderer deny-list, and that a GPU failure is never retried.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';

import { createContext } from 'oxgl';

import { allPixels, gpuSkipReason, readAll, withBackendEnv } from './helpers.mjs';

function renders(gl) {
  gl.clearColor(0, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  assert.ok(allPixels(readAll(gl), [0, 255, 0, 255]));
  assert.equal(gl.getError(), gl.NO_ERROR);
  gl.destroy();
}

test('software backend renders', () => {
  withBackendEnv(undefined, () => renders(createContext({ width: 4, height: 4, backend: 'software' })));
});

test('auto returns a working context without error', () => {
  withBackendEnv(undefined, () => renders(createContext({ width: 4, height: 4 })));
});

test('forced GPU either renders or throws OXGL_GPU_UNAVAILABLE', async (t) => {
  const reason = await gpuSkipReason();
  if (reason?.startsWith('OXGL_BACKEND')) return t.skip(reason);
  withBackendEnv(undefined, () => {
    let gl;
    try {
      gl = createContext({ width: 4, height: 4, backend: 'gpu' });
    } catch (error) {
      assert.equal(error.code, 'OXGL_GPU_UNAVAILABLE');
      assert.match(error.message, /Metal|Vulkan|D3D11/);
      return;
    }
    renders(gl);
  });
});

test('override forces software', () => {
  withBackendEnv('software', () => renders(createContext({ width: 4, height: 4, backend: 'gpu' })));
});

test('override is read per call', () => {
  withBackendEnv('vulkan', () => {
    assert.throws(() => createContext({ width: 1, height: 1 }), { code: 'OXGL_INVALID_BACKEND' });
  });
  withBackendEnv('software', () => renders(createContext({ width: 1, height: 1 })));
  withBackendEnv('', () => renders(createContext({ width: 1, height: 1, backend: 'software' })));
});

test('invalid override value', () => {
  withBackendEnv('vulkan', () => {
    assert.throws(
      () => createContext({ width: 4, height: 4 }),
      (error) =>
        error.code === 'OXGL_INVALID_BACKEND' &&
        error.message.includes('OXGL_BACKEND') &&
        error.message.includes('vulkan'),
    );
  });
});

async function runWorker(override) {
  const worker = new Worker(new URL('./fixtures/backend-worker.mjs', import.meta.url), {
    workerData: { override },
  });
  const [message] = await once(worker, 'message');
  await once(worker, 'exit');
  return message;
}

test('override set inside a worker', async () => {
  const result = await runWorker('software');
  assert.ok(result.ok, result.message);
  assert.deepEqual(result.pixel, [0, 255, 0, 255]);
  // The worker reads its own process.env copy, not the main thread's.
  const invalid = await runWorker('vulkan');
  assert.equal(invalid.code, 'OXGL_INVALID_BACKEND');
  assert.notEqual(process.env.OXGL_BACKEND, 'vulkan');
});

test('environment untouched', async () => {
  const before = JSON.stringify(process.env);
  const reason = await gpuSkipReason();
  withBackendEnv(undefined, () => {
    for (const backend of reason === undefined ? ['software', 'gpu', 'auto'] : ['software', 'auto']) {
      createContext({ width: 1, height: 1, backend }).destroy();
    }
  });
  assert.equal(JSON.stringify(process.env), before);
});
