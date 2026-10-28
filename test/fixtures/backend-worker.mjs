// Worker for backend-selection.test.mjs: sets OXGL_BACKEND in the worker's own
// process.env copy and reports what createContext does.
import { parentPort, workerData } from 'node:worker_threads';

import { createContext } from 'oxgl';

process.env.OXGL_BACKEND = workerData.override;
try {
  const gl = createContext({ width: 4, height: 4, backend: 'gpu' });
  gl.clearColor(0, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const pixel = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  gl.destroy();
  parentPort.postMessage({ ok: true, pixel: [...pixel] });
} catch (error) {
  parentPort.postMessage({ ok: false, code: error.code, message: error.message });
}
