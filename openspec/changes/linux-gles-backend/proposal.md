# Proposal

## Why

On a Raspberry Pi 5, `createContext({ webgl2: true, backend: 'gpu' })` throws `OXGL_GPU_UNAVAILABLE` ("Vulkan: eglChooseConfig failed (EGL error 0x3009)"), and `'auto'` quietly renders WebGL 2 with SwiftShader. ANGLE's Vulkan backend caps the V3D GPU at OpenGL ES 2.0, because Mesa's V3DV driver reports `standardSampleLocations = VK_FALSE` (`Renderer::getMaxSupportedESVersion`, `vk_renderer.cpp`). Mesa's V3D GL driver gives a headless process OpenGL ES 3.1 through EGL's surfaceless platform, and ANGLE's OpenGL ES backend can serve WebGL 2 on top of it. oxgl's Linux bundles are built without that backend (`angle_enable_gl = false` in oxgl-angle's `angle/args/common.gn`).

## What Changes

- **The Linux ANGLE bundles gain ANGLE's OpenGL ES backend** (oxgl-angle recipe change, new `bundle_version`). It is built without X11, Wayland or GBM. ANGLE opens the system's `libEGL.so.1` with `dlopen` only when an OpenGL ES display is initialized, so the shipped libraries still link only glibc and its runtime, and importing oxgl or using Vulkan or SwiftShader needs no Mesa libraries.
- **On Linux, a WebGL 2 request uses the OpenGL ES backend when the Vulkan GPU can only give OpenGL ES 2.0.** This is the automatic option (option 1 of the brief), recommended over a new `backend` value; see design.md, "Selection is automatic". It applies to `'gpu'` and `'auto'`, and to `OXGL_BACKEND=gpu`/`auto`. Nothing changes where Vulkan gives OpenGL ES 3.0 or where Vulkan fails. `OXGL_BACKEND` keeps overriding the option as today, and no new public value is added.
- **WebGL 1 uses the OpenGL ES backend on those GPUs too, and Vulkan serves no context there.** V3DV segfaults the process on a WebGL 1 shader that indexes a sampler array with a loop variable, and the OpenGL ES backend renders it. Without that backend, `'gpu'` throws and `'auto'` uses SwiftShader; see design.md.
- **`generateMipmap` on a float texture is refused on that backend when the driver can't filter float.** WebGL 1 otherwise loses the context, since ANGLE passes the call to a driver that refuses it.
- **Each thread on macOS gets its own Metal display.** Threads sharing one read stale pixels and can crash the process, through ANGLE defects outside this change's original scope, found by its worker test.
- **`drawRangeElements` draws as `drawElements`.** A GLES driver may trust `start` and `end`, and llvmpipe reads outside its vertex data when indices are outside them. The WebGL 2 specification allows discarding them.
- **`'gpu'` stays GPU-only on the OpenGL ES backend.** A renderer naming llvmpipe, softpipe or a software rasterizer is refused with `OXGL_GPU_UNAVAILABLE`, with the renderer string in the message. This matters because Mesa falls back to llvmpipe without an error when it cannot open the GPU (observed on the Pi as a user outside `render`).
- **The drawing buffer needs no EGL config change.** It is oxgl's own framebuffer of `RGBA8` and `DEPTH24_STENCIL8` renderbuffers, 4 samples when `antialias` is true, and the context is surfaceless. ANGLE's OpenGL ES backend creates its native context with `EGL_KHR_no_config_context`, which Mesa supports, so no EGL config choice reaches Mesa's drawing surfaces. Tests check `getContextAttributes()` and the `*_BITS`/`SAMPLES` parameters on the new backend.
- **A test-only OpenGL ES mode.** An addon built with the Cargo feature `test-gles` accepts `OXGL_BACKEND=gles`. This forces the OpenGL ES backend for every request and accepts a CPU renderer, so CI can run the backend on Mesa's llvmpipe. Release builds don't have the feature and reject `gles` as `OXGL_INVALID_BACKEND`.
- **CI runs the OpenGL ES backend on Linux x64**: the Node tests, both conformance suites and the three.js examples, on llvmpipe through `OXGL_BACKEND=gles`. They are judged against expectations for a new target, `linux-x64-gles`.
- **`npm run bench -- --webgl1`** runs the benchmark with WebGL 1 contexts. It compared the Pi's two GPU paths until WebGL 1 moved to the OpenGL ES backend, and those numbers stay in design.md.
- **README:** the backend table, errors table and prerequisites describe the OpenGL ES backend and the Mesa packages it needs (`libegl1`, `libegl-mesa0`).

### Out of scope

- Changing ANGLE's `standardSampleLocations` gate, or shipping a Vulkan layer.
- The OpenGL ES backend on macOS or Windows.
- Trying the OpenGL ES backend when Vulkan fails outright or is rejected as a CPU. Machines with a GL driver but no Vulkan driver are an extension point: the candidate list in `Backends` takes another rule without new mechanism.
- Conformance and three.js runs on the Pi in CI. The Pi has no runner; its results are recorded in this change (design.md, "Results on the Pi") and in the README's known issues.
- The OpenGL ES backend on the Linux arm64 CI runner. Linux x64 covers the code path. Adding arm64 would double the long suites' cost while the CI redesign is on hold.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `backend-selection`: on Linux the GPU candidates for a request gain the OpenGL ES backend. The CPU-renderer rule, the GPU-unavailable message, failure memory and `auto` fallback cover it. A test-only `gles` override is added.
- `backend-selection`: on macOS, each thread uses its own Metal display.
- `drawing`: `drawRangeElements` discards its range.
- `textures`: `generateMipmap` on an unfilterable float texture on the OpenGL ES backend.
- `angle-distribution`: the Linux bundles enable ANGLE's OpenGL ES backend. The no-window-system requirement adds that the system EGL library is opened only at run time, never linked.
- `conformance-testing`: expectation platforms gain the `linux-x64-gles` target, used when a run uses `OXGL_BACKEND=gles`, and an update run counts six platforms.
- `threejs-examples`: the update scenario under "Platform-limited expectations" lists the sixth platform.
- `results-page`: a linux-x64-gles column after windows-arm64.
- `continuous-integration`: a Linux x64 OpenGL ES job, and a test-only addon built alongside the Linux x64 packages.

## Impact

- **oxgl-angle**: `angle/args/*.gn`, `angle/scripts/bundle.py` (required GN args, and a check that no library links `libEGL.so.1`, `libGL*` or `libdrm`), `angle/pin.toml` (`bundle_version` → `angle-8078.8`, and `angle-8103.3` by the end of this change), `angle/README.md`.
- **oxgl**: `angle/bundles.toml`; `crates/oxgl-sys/src/egl.rs` (a `DisplayKind::Gles`), `loader.rs` and `textures.rs` (adding `eglTerminate` and `glGetTexLevelParameterivANGLE`, removing `glDrawRangeElements`); `crates/oxgl-core/src/backend.rs`, `context.rs`, `runtime.rs`, `rendering.rs`, `textures.rs`, `drawing_buffer.rs`; `crates/oxgl-node` (the `test-gles` feature); `src/context.ts` (`resolveBackend`); `conformance/expectations.mjs`, `conformance/expectations.txt`, `threejs/expectations.txt`; `scripts/results-page.mjs`; `bench/run.mjs`; `.github/workflows/ci.yml`; `README.md`, `CONTRIBUTING.md`; new tests.
- **Package size**: the Linux `libGLESv2.so` grows by the OpenGL ES backend and the GLSL ES translator output, measured in task 1.3.
- **Runtime**: a process on an ES 2.0-only Vulkan GPU loads Mesa's GL driver once and keeps its display until exit, as displays are never terminated today.
