// backend-selection spec scenarios. Which backend rendered is not observable
// from JS; the Rust tests (oxgl-core backend.rs) cover selection order, the
// CPU-renderer deny-list, and that a GPU failure is never retried.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';

import { createContext } from '@oxgl-js/oxgl';

import { allPixels, gpuSkipReason, oneVulkanDevice, readAll, withBackendEnv } from './helpers.mjs';

/** Whether this run uses the test-only OpenGL ES backend (a `test-gles` addon, in CI on llvmpipe). */
const testGles = process.env.OXGL_BACKEND === 'gles';

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
  // Listen for both before awaiting either: a worker that posts and exits
  // quickly has its message drained and 'exit' emitted in one synchronous
  // step, before an `await` on 'message' could register the 'exit' listener.
  const [[message]] = await Promise.all([once(worker, 'message'), once(worker, 'exit')]);
  return message;
}

test('override set inside a worker', { timeout: 30_000 }, async () => {
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
  const cwd = process.cwd();
  const reason = await gpuSkipReason();
  // 'software' ran first in this process, so on Linux it holds the one Vulkan
  // device and 'gpu' would be refused.
  const gpu = reason === undefined && !oneVulkanDevice;
  withBackendEnv(undefined, () => {
    for (const backend of gpu ? ['software', 'gpu', 'auto'] : ['software', 'auto']) {
      for (const webgl2 of [false, true]) createContext({ width: 1, height: 1, backend, webgl2 }).destroy();
    }
  });
  // The OpenGL ES backend loads the system's EGL driver into the process.
  if (testGles) {
    withBackendEnv('gles', () => createContext({ width: 1, height: 1, webgl2: true }).destroy());
  }
  assert.equal(JSON.stringify(process.env), before);
  assert.equal(process.cwd(), cwd);
});

/**
 * Runs `script` (an ES module that may import oxgl) in a child process without
 * OXGL_BACKEND, so the backends it names are used, and returns its last stdout
 * line as JSON.
 */
function inChild(script) {
  const env = { ...process.env };
  delete env.OXGL_BACKEND;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

/** A child script creating a context on each of `backends` in turn, reporting each renderer or error. */
function contextsScript(backends) {
  return `
    import { createContext } from '@oxgl-js/oxgl';
    const results = [];
    for (const backend of ${JSON.stringify(backends)}) {
      try {
        const gl = createContext({ width: 4, height: 4, backend });
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        results.push({ renderer: gl.getParameter(info.UNMASKED_RENDERER_WEBGL) });
      } catch (error) {
        results.push({ code: error.code, message: error.message });
      }
    }
    console.log(JSON.stringify(results));
  `;
}

test('a Linux process uses one Vulkan device', { timeout: 60_000 }, async (t) => {
  const reason = await gpuSkipReason();
  if (reason !== undefined) return t.skip(reason);
  if (!oneVulkanDevice) return t.skip('only Linux shares one Vulkan display between the GPU and SwiftShader');
  const [, software] = inChild(contextsScript(['gpu', 'software']));
  assert.equal(software.code, 'OXGL_CONTEXT_CREATION_FAILED', software.message ?? software.renderer);
  assert.match(software.message, /the Vulkan GPU is in use, and a Linux process uses one Vulkan device/);
  const [, gpu, auto] = inChild(contextsScript(['software', 'gpu', 'auto']));
  assert.equal(gpu.code, 'OXGL_GPU_UNAVAILABLE', gpu.message ?? gpu.renderer);
  assert.match(gpu.message, /SwiftShader is in use/);
  assert.match(auto.renderer, /SwiftShader/);
});

test('software after auto on a host without a GPU renders on SwiftShader', { timeout: 60_000 }, async (t) => {
  if (process.env.OXGL_BACKEND) return t.skip(`OXGL_BACKEND=${process.env.OXGL_BACKEND} forces a backend`);
  const reason = await gpuSkipReason();
  if (reason === undefined) return t.skip('this host has a GPU');
  // On Linux, a GPU display rejected as a CPU (such as Mesa's lavapipe) is
  // released, so SwiftShader can initialize.
  for (const result of inChild(contextsScript(['auto', 'software']))) {
    assert.match(result.renderer ?? result.message, /SwiftShader/);
  }
});

// The OpenGL ES backend loads the system's EGL driver, whose threads and
// atexit handlers must not stop the process from exiting.
test('a process exits cleanly after WebGL 2 contexts', { timeout: 60_000 }, async () => {
  const backends = (await gpuSkipReason()) === undefined ? ['auto', 'gpu'] : ['auto'];
  for (const backend of backends) {
    const script = `
      import { createContext } from '@oxgl-js/oxgl';
      createContext({ width: 4, height: 4, backend: '${backend}', webgl2: true }).destroy();
      const kept = createContext({ width: 4, height: 4, backend: '${backend}', webgl2: true });
      kept.clear(kept.COLOR_BUFFER_BIT);
      console.log('ok');
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${backend}: ${result.stderr}`);
    assert.equal(result.stdout.trim(), 'ok');
  }
});

test('test-only OpenGL ES value rejected by a release build', { skip: testGles && 'this is a test-gles build' }, () => {
  withBackendEnv('gles', () => {
    assert.throws(
      () => createContext({ width: 1, height: 1 }),
      (error) => error.code === 'OXGL_INVALID_BACKEND' && error.message.includes('gles'),
    );
  });
});

test('test-only OpenGL ES backend renders on llvmpipe', { skip: !testGles && 'needs a test-gles build with OXGL_BACKEND=gles' }, () => {
  for (const webgl2 of [false, true]) {
    const gl = createContext({ width: 4, height: 4, webgl2 });
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
    assert.match(renderer, /llvmpipe/);
    assert.match(renderer, /OpenGL ES/);
    renders(gl);
  }
});
