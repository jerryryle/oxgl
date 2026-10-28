# Tasks

## 1. oxgl-sys: ANGLE loading and bindings

- [x] 1.1 Generate EGL/GLES types and constants with bindgen from the bundle headers (build-time, via the staged include path); verify generated bindings compile and clippy passes with generated code allow-listed at module scope only
- [x] 1.2 Implement the runtime loader (libloading, `eglGetProcAddress` for GLES) taking an explicit absolute bundle directory: `oxgl-node` passes the directory next to the addon; Rust tests in any crate get the staged directory from `oxgl_sys::test_support::bundle_dir()`, which exists only with the `test-support` feature (enabled through `oxgl-core`'s dev-dependencies) and is the only code that reads the build-time path; the production loader has no fallback path and never uses the system search path; verify a release build of the addon contains no staging path string; returns a coded error when files are missing; verify with a Rust test that loads the bundle and one that points at an empty directory
- [x] 1.3 Implement safe wrappers for the EGL/GLES calls this change needs (display, config, pbuffer, context, make-current, clearColor, clear, readPixels, getError, reset status, getString, getIntegerv) with the `Current<'_>` token; verify every `unsafe` block has a `// SAFETY:` comment and clippy passes

## 2. oxgl-core: runtime structures

- [x] 2.1 Implement `BackendProbe` (trait + ANGLE implementation + fake for tests), per-backend display cache with process-lifetime caching of GPU failures (including CPU-renderer rejection), CPU-renderer deny-list, and `auto`/`gpu`/`software` resolution of the already-resolved requested backend (the env override is read in TS, see 3.2); verify with unit tests using the fake probe, including auto fallback and gpu-unavailable
- [x] 2.2 Implement `ErrorState` (flag set, synthesized + GL drain, lost-context sequence); verify with unit tests for ordering, one-shot `CONTEXT_LOST_WEBGL`, and merged validation/GL errors
- [x] 2.3 Implement `Context`, `DrawingBuffer` (pbuffer, size clamping with aspect ratio), per-context object slotmap, `Runtime` (context slotmap, deletion queue), and a current-context check in `oxgl-sys`'s `make_current` that skips `eglMakeCurrent` when the context is already current; verify with Rust integration tests on SwiftShader: create/destroy, stale key resolves to lost, two contexts interleaved, live-object counters return to zero
- [x] 2.4 Implement clear/clearColor and readPixels (size math with checked arithmetic, view type/size validation, writes only through `oxgl-sys`'s call-scoped `WriteTarget` (`node` feature) with no Rust reference to view memory, always using a private temporary with relaxed-atomic copy-in from the view before `glReadPixels` and copy-out after, so out-of-bounds bytes are preserved, and out-of-bounds pixels left to ANGLE); verify with Rust integration tests for every pixel-readback scenario, plus unit tests of the size math for padded rows (RGB and 1-byte formats at alignments 1, 2, 4, 8, exact size and size minus one)

## 3. oxgl-node and TypeScript API

- [x] 3.1 Add `#[napi]` entry points, instance-data `Runtime` whose finalizer is the environment cleanup hook (it destroys live contexts at teardown), error-code mapping, an idempotent native `destroy(key)` for `destroy()`, and a native `release(key)` (enqueue then drain) for the TS `FinalizationRegistry` callback. The registry is module-level, its callback captures nothing, its held value is only the `[index, version]` u32 pair (keys never cross to JS as one number), verified with a unit test that round-trips a key whose version exceeds 2^21, and `destroy()` unregisters. Contexts get no Node-API finalizer; verify `cargo clippy --workspace --all-targets -- -D warnings` passes and no `unsafe` was added outside `oxgl-sys`
- [x] 3.2 Add `src/context.ts` with `WebGLRenderingContext`/`WebGL2RenderingContext` classes (WebIDL conversions, constants on class and prototype, read-only drawing buffer attributes, `destroy()`), and `createContext` option validation including reading `OXGL_BACKEND` from `process.env` per call (rejecting invalid values with `OXGL_INVALID_BACKEND`) and passing the resolved backend to native; verify with a worker-thread test and `npm run lint` and `tsc` type tests for the public types
- [x] 3.3 Add `test/context-creation.test.mjs`, `test/backend-selection.test.mjs`, `test/drawing.test.mjs`, `test/pixel-readback.test.mjs`, `test/error-reporting.test.mjs` covering every scenario in the specs; verify `OXGL_BACKEND=software npm test` passes on the dev machine
- [x] 3.4 Add GPU variants of clear-then-readPixels that skip with a reason on `OXGL_GPU_UNAVAILABLE` or when `OXGL_BACKEND` forces another backend; verify they run (not skip) on a macOS or GPU-equipped dev machine

## 4. Memory and lifecycle verification

- [x] 4.1 Add `test/soak.test.mjs` (run with `--expose-gc`): 50 warm-up, then 1,000 create/destroy cycles at 256×256 (count overridable via `OXGL_SOAK_ITERATIONS` for CI; record the measured per-cycle time in the test output), RSS delta ≤ 32 MiB after forced GC, with a GC-only variant that drops contexts without `destroy()`; verify it passes in software mode and fails when a deliberate leak (skipping pbuffer destruction) is introduced
- [x] 4.2 Add a Rust integration soak test with live-object counters asserting zero EGL contexts/surfaces after 1,000 cycles; verify it passes and is runnable under AddressSanitizer (used by `ci-pipeline`)
- [x] 4.3 Add the detach-after-read test (`structuredClone` transfer of the destination after `readPixels`); verify it passes
- [x] 4.4 Compare lost-context `drawingBufferWidth/Height` behavior with Chromium (`WEBGL_lose_context`) and amend the context-creation spec if it differs; verify the spec and implementation agree

## 5. Documentation

- [x] 5.1 Document `createContext`, backends, `OXGL_BACKEND`, `destroy()`, and error codes in the README with a runnable example; verify the example runs as written
- [x] 5.2 Verify every Khronos spec citation and conformance-test path in this change's specs against the current published specifications and the KhronosGroup/WebGL repository
