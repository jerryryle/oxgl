## 1. ANGLE bundles with the OpenGL ES backend (oxgl-angle)

- [x] 1.1 In `angle/args/`, move `angle_enable_gl` out of `common.gn`: `true` in `linux-x64.gn` and `linux-arm64.gn`, `false` in the macOS and Windows files. Set `angle_enable_gl_desktop_backend = false` on Linux if the GLES-on-EGL path builds and runs without it, and otherwise leave it at its default and say why in design.md. Keep `angle_use_x11`, `angle_use_wayland` and `angle_use_gbm` off.
- [x] 1.2 In `angle/scripts/bundle.py`, require `angle_enable_gl = true` on both Linux platforms, and fail when a Linux library has a `NEEDED` entry for `libEGL.so.1`, `libGL`, `libGLESv2.so.2`, `libgbm` or `libdrm`, or exports `drm*` symbols. Bump `bundle_version` to `angle-8078.8` and add the README's notes on the GL backend (what it is for, and that it opens `libEGL.so.1` only at run time).
- [x] 1.3 Build both Linux bundles through the `angle-build` pull-request run. From its `angle-linux-x64` and `angle-linux-arm64` artifacts, verify:
  - `readelf -d`: only glibc, `libgcc_s` and `libm`;
  - `nm -D`: no `drm*` or LLVM symbols;
  - the smoke test passes on hosts without Mesa;
  - the size change of `libGLESv2.so`, recorded in design.md.

  Verify on the Pi that `EGL_PLATFORM_ANGLE_TYPE_OPENGLES_ANGLE` with `EGL_PLATFORM_SURFACELESS_MESA` initializes and gives an ES 3 context, with a C probe against the artifact's libraries.
- [x] 1.4 After the recipe change merges and `angle-8078.8` is released, copy its URLs and digests into oxgl's `angle/bundles.toml` and run `python3 angle/scripts/check_pin.py`. Verify that `npm run build` and `npm test` pass on macOS arm64 against the new pin.
- [x] 1.5 In oxgl-angle, add `angle/patches/angle-gles-rgb8-implementation-read-format.patch` (the design's ANGLE recipe section), with `ReadPixelsTest.RGBImplementationColorReadFormat` in ANGLE's tests and its row in the README's "Source patches" table, and bump `bundle_version` to `angle-8078.9`. Verify that the patched files compile with ANGLE's flags and the test passes on macOS. On the pull-request run's Linux artifacts, verify that the C probe reads an `RGB8` framebuffer in its advertised format on the Pi's V3D, in a WebGL context and without losing it, and that `OXGL_BACKEND=gles npm test` passes in the arm64 container. After the release, pin it as in 1.4. (Done: patch, test, README row, release and pin; the test passes on macOS and `OXGL_BACKEND=gles npm test` passes in the arm64 container against the release. The Pi probe passed against `angle-8103.1`, which main now pins and which carries the patch.)

## 2. Display and selection (oxgl-sys, oxgl-core)

- [x] 2.1 In `crates/oxgl-sys/src/egl.rs`, add `DisplayKind::Gles` (Linux only) with platform type `EGL_PLATFORM_ANGLE_TYPE_OPENGLES_ANGLE` and native platform type `EGL_PLATFORM_SURFACELESS_MESA`, adding the constants to the bindings if missing. Add `Display::supports(ClientVersion) -> bool` over the existing `choose_config`. Keep every `unsafe` block's `// SAFETY:` comment accurate. Verify with clippy pedantic and an `oxgl-sys` test that `supports(Es3)` is true on SwiftShader.
- [x] 2.2 In `crates/oxgl-core/src/backend.rs`:
  - add the `gles` display slot;
  - record whether the Vulkan display offers ES 3.0 when it opens;
  - for a WebGL 2 request on Linux, try GLES only when the Vulkan display opened, passed the CPU check and offers no ES 3.0;
  - run the CPU-renderer check on the GLES display, adding `swrast` and `software rasterizer` to `CPU_RENDERERS`;
  - name both backends in `'gpu'` and `'auto'` messages.

  Verify with `FakeProbe` unit tests for each backend-selection scenario: WebGL 2 on ES 2-only Vulkan goes to GLES under `'gpu'` and `'auto'`; WebGL 1 stays on Vulkan; Vulkan with ES 3 never opens GLES; a failed or CPU Vulkan display never opens GLES; a CPU GLES renderer is refused with its string in the message; both causes are named; the GLES display failure is remembered; a Vulkan ES 3 context failure doesn't divert; displays still open once.
- [x] 2.3 Add the `test-gles` Cargo feature to `oxgl-node`, forwarded to `oxgl-core`. With it, the native module exports `testBackends = ['gles']`, and the `gles` requested backend uses only the GLES display, with no CPU check and no fallback. Gate the feature's code on Linux as design.md says. In `src/context.ts`, accept `OXGL_BACKEND=gles` only when `testBackends` lists it, and keep `gles` in the context's creation parameters, so a restore uses the GLES display again. Verify with a Rust unit test of the `gles` path, a Node test that a release build rejects `gles` with `OXGL_INVALID_BACKEND`, and `cargo clippy --workspace --all-targets --all-features -- -D warnings`.

## 3. Linux verification of the code path (Docker, CI image)

Each check names its architecture, and its result stands only for that architecture (CLAUDE.md, "Testing on Linux arm64"). On this arm64 Mac, Docker runs `linux/arm64` natively. Linux x64 results come from the CI `gles` job, or from an explicit `--platform linux/amd64` container under emulation.

- [x] 3.1 In a `linux/arm64` Docker container without Mesa, import oxgl built against the new bundle, create SwiftShader contexts, and check with `strace -f -e openat` that `libEGL.so.1` is never opened. Run `ldd` on every shipped library. Repeat for Linux x64 in a `--platform linux/amd64` `ubuntu:24.04` container. Record both in design.md, each labelled with its architecture.
- [x] 3.2 In a `linux/arm64` `ubuntu:24.04` container with `libegl1 libegl-mesa0 libgl1-mesa-dri`, build with `test-gles`, run `OXGL_BACKEND=gles npm test`, and fix what fails. Record the exact `GL_RENDERER` string under ANGLE in design.md as the arm64 llvmpipe result, and confirm `is_cpu_renderer` matches it. The Linux x64 results, and the `linux-x64-gles` expectations, come only from the CI `gles` job (6.2, 6.3).

## 4. Browser behaviour on the OpenGL ES backend

- [x] 4.1 Add Node tests, run without a `backend` option so they follow `OXGL_BACKEND`, for each item of "Browser behaviour on the OpenGL ES backend" not already covered on every backend:
  - `getContextAttributes()` and `RED/GREEN/BLUE/ALPHA/DEPTH/STENCIL_BITS` and `SAMPLES` match the allocated buffer, with and without `antialias`;
  - new buffers, textures and renderbuffers read as zeros;
  - every name `getSupportedExtensions()` lists is enabled by `getExtension`;
  - `loseContext`/`restoreContext`, `destroy()`, `encodePNG`, and uploads from `ImageData`-shaped objects and 2D canvases.

  Verify they pass with `OXGL_BACKEND=software`, and with `gles` in the container from 3.2.
- [x] 4.2 Add backend-selection Node tests, which may name a backend because selection is what they check:
  - with `OXGL_BACKEND=gles`, `GL_RENDERER` names llvmpipe;
  - in a release build, `gles` is rejected;
  - on a GPU host, a WebGL 2 `'gpu'` context renders, skipping with the reason elsewhere, as `gpu.test.mjs` does;
  - the "Environment untouched" test of "Display reuse and isolation" also covers the OpenGL ES display: `process.env` and `process.cwd()` are identical before and after a context is created on it, under `OXGL_BACKEND=gles` and, on the Pi, through the automatic WebGL 2 path. Run in the gles CI job and in 5.4.
- [x] 4.3 Add a test that creates and destroys 200 GLES contexts in one process and checks that thread count and RSS stop growing. Add another that a child process exits with status 0 after using a GLES context. Verify both in the container, and on the Pi in 5.x.

## 5. On the Pi (Raspberry Pi 5, V3D)

- [x] 5.1 Install the build on the Pi with Mesa's `libegl1 libegl-mesa0`, checking whether `libgles2` is needed, and correct the README if so. Verify the first two backend-selection Pi scenarios: WebGL 2 `'gpu'` gives a renderer naming V3D (not Vulkan, not llvmpipe), RGBA bits 8/8/8/8, and `SAMPLES` 4 with `antialias: true`. Also check that WebGL 1 stays on Vulkan.
- [x] 5.2 Verify the refusals: as `oxglnorender` (outside `render`), and as `baton` with `LIBGL_ALWAYS_SOFTWARE=1`, `'gpu'` WebGL 2 throws `OXGL_GPU_UNAVAILABLE` naming the refused CPU renderer and returns no context.
- [x] 5.3 Verify done-when 5 for Vulkan on the Pi. Remove Mesa's EGL and GL libraries (`sudo apt-get remove libegl1 libegl-mesa0`, recording what apt removes with them), then confirm that `/usr/lib/aarch64-linux-gnu/libEGL.so.1` is gone. Then:
  - import oxgl;
  - create a WebGL 1 `'gpu'` context, which must render with a renderer naming V3DV, and a `'software'` context;
  - check that a WebGL 2 `'gpu'` request throws `OXGL_GPU_UNAVAILABLE`, naming `OpenGL ES` with a cause about `libEGL.so.1`;
  - reinstall the packages afterwards.

  Record the results in design.md.
- [x] 5.4 Run `npm test` on the Pi with no `OXGL_BACKEND` (WebGL 2 tests on GLES, WebGL 1 on Vulkan), and with `OXGL_BACKEND=gpu`. Fix oxgl defects.
- [x] 5.5 Run both conformance suites and `npm run threejs` on the Pi with `OXGL_BACKEND=gpu`, so WebGL 2 runs on GLES. Record every failing page and example in design.md's "Results on the Pi" with its reason, marking which are V3D's (they also fail with Mesa's GL directly, or with a V3D-specific cause) and which are oxgl's. Fix oxgl's, or bring them back as findings. Add V3D failures to the README's known issues.
- [x] 5.6 Add `--webgl1` to `bench/run.mjs`. Run `npm run bench` on the Pi on GLES (WebGL 2, default) and on Vulkan (`--webgl1`), with `OXGL_BACKEND=gpu`, and record both side by side in design.md.

## 6. Expectations and CI

- [x] 6.1 Add `linux-x64-gles` last to `PLATFORMS` in `conformance/expectations.mjs`, chosen when `OXGL_BACKEND=gles` on Linux x64. Verify with `conformance-harness.test.mjs`, `threejs-harness.test.mjs` and `results-page.test.mjs` cases for the new conformance-testing, threejs-examples and results-page scenarios and the unknown-platform error.
- [ ] 6.2 In `.github/workflows/ci.yml`:
  - the Linux x64 build job, after packing, builds the `test-gles` addon into `dist-gles/` and uploads it as `addon-linux-x64-gles`, unpacked. Its pack check asserts that the packed addon rejects `OXGL_BACKEND=gles`;
  - a new `gles` job installs Mesa, unpacks the run's Linux x64 packages, swaps in that addon, and runs `npm test`, both conformance suites and `npm run threejs` with `OXGL_BACKEND=gles`, uploading reports as the other suite jobs do;
  - the `ci` job needs it.

  Update `CONTRIBUTING.md`'s job table. Verify with actionlint and zizmor as the workflow lint job runs them.
- [ ] 6.3 Record the `linux-x64-gles` entries in `conformance/expectations.txt` and `threejs/expectations.txt`. `--update` writes only the host's own platform and CI never runs it, so run it in a `--platform linux/amd64` `ubuntu:24.04` container. Install the CI job's Mesa packages there, with the run's Linux x64 packages and `addon-linux-x64-gles` unpacked into `dist/`, `export OXGL_BACKEND=gles`, and run `npm run conformance -- --update` and `npm run threejs -- --update` in that shell, so both runs judge and write the `linux-x64-gles` platform. Give each new entry its reason. Emulation can turn slow pages into `TIMEOUT`s that native x64 doesn't have, so check every entry against the CI job's downloaded reports (`gh run download`) and keep only outcomes the CI run shows. Verify that a rerun of the `gles` job passes with no stale entries.

## 7. Docs

- [x] 7.1 README:
  - the backend table says that on Linux a WebGL 2 context uses the OpenGL ES backend on the system's EGL driver when the Vulkan GPU gives OpenGL ES 2.0 only;
  - the errors table's `OXGL_GPU_UNAVAILABLE` row mentions the CPU-renderer refusal on either backend;
  - Prerequisites list Mesa's EGL packages for that case;
  - the Platforms table and Known issues carry the Pi results.

  Verify by reading the README against the specs.

## 8. Verification

- [ ] 8.1 Run `npm run lint` and `npm test` on macOS arm64. Confirm CI's `ci` check passes on every platform, including the new `gles` job.
- [ ] 8.2 Confirm each "Done when" item of the brief against its task: 5.1 (1), 5.2 (2), 5.5 (3), 5.6 (4), 3.1 with 5.3 (5), and 6.2 with 8.1 (6). Report the outcome of each with its evidence.
