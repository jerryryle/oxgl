// GPU soak tests (context-creation spec: "No resource growth across context
// lifecycles"), in a file of their own: on Linux a process uses one Vulkan
// device, so they can't share a process with the software soak tests.
import { test } from 'node:test';

import { gpuSkipReason } from './helpers.mjs';
import { soak } from './soak-helpers.mjs';

const gpuSkip = await gpuSkipReason();

test('GPU soak test', { skip: gpuSkip }, (t) => {
  soak(t, 'gpu');
});

// On Linux, a GPU whose Vulkan driver offers OpenGL ES 2.0 only (the Pi 5's
// V3D) runs WebGL 2 on the OpenGL ES backend, which loads the system's EGL
// driver. Under OXGL_BACKEND=gles every soak test runs there.
test('GPU soak test (WebGL 2)', { skip: gpuSkip }, (t) => {
  soak(t, 'gpu', true);
});
