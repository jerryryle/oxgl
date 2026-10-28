// Worker for pixel-readback.test.mjs: writes to one region of a shared buffer
// until told to stop.
import { workerData } from 'node:worker_threads';

const { buffer, offset, length } = workerData;
const region = new Uint8Array(buffer, offset, length);
const control = new Int32Array(buffer, 0, 1);
Atomics.store(control, 0, 1);
Atomics.notify(control, 0);
for (let value = 0; Atomics.load(control, 0) === 1; value = (value + 1) & 0xff) {
  region.fill(value);
}
