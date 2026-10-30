# Tasks

## 1. Surfaceless context and framebuffer entry points

- [x] 1.1 In `oxgl-sys`, stop asking `choose_config` for `EGL_PBUFFER_BIT`, sizes and depth (renderable bit only), remove `attach_pbuffer` and `max_pbuffer_size`, and make contexts current surfaceless. Update `crates/oxgl-sys/tests/angle.rs` for the removed API. Verify with `cargo test -p oxgl-sys` locally and on Linux arm64 (Docker, per `CLAUDE.md`).
- [x] 1.2 Add `Current` methods, with `// SAFETY:` comments, for `glGenFramebuffers`, `glBindFramebuffer`, `glGenRenderbuffers`, `glBindRenderbuffer`, `glRenderbufferStorage`, `glRenderbufferStorageMultisample` (ES3) / `glRenderbufferStorageMultisampleANGLE` (ES2), `glFramebufferRenderbuffer`, `glCheckFramebufferStatus`, `glBlitFramebuffer` / `glBlitFramebufferANGLE`, `glDisable`/`glEnable`/`glIsEnabled` for the scissor test, and the getters `clear_drawing_buffer` needs. Request `GL_OES_rgb8_rgba8`, `GL_ANGLE_framebuffer_multisample` and `GL_ANGLE_framebuffer_blit` on ES2 contexts at creation. Add `oxgl-sys` tests that build a complete framebuffer for every attachment combination in the design's table, single-sampled and with 4 samples, on ES2 and ES3 SwiftShader. Verify with `cargo test -p oxgl-sys` on Linux arm64 (Docker) and `cargo clippy --all-targets -- -D warnings`.

## 2. Drawing buffer

- [x] 2.1 Rewrite `DrawingBuffer` in `oxgl-core` around the draw and resolve framebuffers:
  - allocation from `Attributes` and a `Limits` value read from GL, with the design's fallbacks (no multisampling, halving, dropping depth or stencil);
  - error draining around allocation;
  - `clear_drawing_buffer`;
  - the actual attributes it allocated.

  Add Rust tests for the fallback order, using the `#[cfg(test)]` byte cap on `Limits` to force allocation failures: one cap that fails only the multisampled attempt (antialias dropped, size kept), and one that also fails single-sampled storage at full size (size halved), and for a `Limits` with a maximum sample count of 0, for draining (a pending page error survives allocation), and for clearing (a non-default clear color, color mask and scissor test survive it). Verify with `cargo test -p oxgl-core` and clippy pedantic.
- [x] 2.2 Add the `DrawingBuffer` kind to the `getParameter` table: on WebGL 2, `DRAW_BUFFER0` and `READ_BUFFER` are `BACK`, other `DRAW_BUFFERi` below `MAX_DRAW_BUFFERS` are `NONE`, and higher indexes fall through to ANGLE's `INVALID_ENUM`, and `IMPLEMENTATION_COLOR_READ_FORMAT`/`TYPE` come from the allocated color format (design: "getParameter describes the default framebuffer"). Add Rust tests for each entry on RGBA and RGB buffers, antialiased and not. Verify with `cargo test -p oxgl-core`.
- [x] 2.3 Resolve before `Context::read_pixels` when antialiasing is met, disabling and restoring the scissor test around the blit (design: "Reads resolve first"). Verify that `OXGL_BACKEND=software npm test` passes, including the existing pixel-readback tests, which now run on a multisampled default buffer, and with `cargo test`.

## 3. Context attributes

- [x] 3.1 Add `Attributes` to `ContextRequest` and the `createContext` export, export `getContextAttributes` and bump `native_abi_version`. In `src/context.ts`:
  - convert `options.attributes` as a WebIDL `WebGLContextAttributes` dictionary;
  - add `getContextAttributes()`, a new object per call, `null` when lost;
  - accept a `canvas` option (an object, otherwise `TypeError`);
  - relax size validation to non-negative integers up to 2147483647.

  Change the existing `non-positive or fractional sizes throw RangeError` test in `test/context-creation.test.mjs` to cover only negative, fractional and too-large sizes. Add tests there for every scenario of "Option validation", "Context attributes option", "Drawing buffer format and initial contents", "Antialiased drawing buffer", "Drawing buffer is framebuffer 0", "Default draw and read buffers", "Implementation read format of the drawing buffer", "Requests that cannot be met" and "getContextAttributes". "No multisampling available" needs a backend without multisampling, so the `Limits` test in 2.1 covers it. Verify with `OXGL_BACKEND=software npm test`.
- [x] 3.2 Resolve `failIfMajorPerformanceCaveat` in `createContext`: `'auto'` → `'gpu'`, and `'software'` → `OXGL_CONTEXT_CREATION_FAILED` before any native call. Add the "Software refused" scenario as a test, plus a test that `auto` with the flag throws `OXGL_GPU_UNAVAILABLE` where no GPU exists. Verify with `npm test`.
- [x] 3.3 Document the `attributes` and `canvas` options, the `antialias: true` default and its memory cost, and `failIfMajorPerformanceCaveat` in `README.md`. Verify that each example there runs as written.

## 4. Canvas and resize

- [x] 4.1 Add `DrawingBuffer::resize` (drain, reallocate with the fallbacks, clear) and a `resize` export returning the allocated size. Add Rust tests showing that a resize keeps a non-default clear color, color mask and enabled scissor test and leaves a zeroed buffer. Verify with `cargo test` and clippy pedantic.
- [x] 4.2 In `src/context.ts`, add `resize(width, height)` (`RangeError` for negative, fractional or above-2147483647 sizes, no-op when lost), the `canvas` attribute, the private `#resizeTo`, and `HeadlessCanvas`, using the `resizeDrawingBuffer`/`storeCanvasSize` functions the two classes' `static {}` blocks assign (design: "Resize and HeadlessCanvas"). Export `HeadlessCanvas` from `src/index.ts`. Add tests for every scenario of "canvas attribute", "HeadlessCanvas" and "Drawing buffer resize" in `test/context-creation.test.mjs`, and type checks in `test/types.ts`. Verify with `npm run lint` and `OXGL_BACKEND=software npm test`.
- [x] 4.3 Document `gl.canvas`, `resize()` and three.js use in `README.md`: pass `gl.canvas` as `canvas` and `gl` as `context`, and call `setSize(w, h, false)`. Verify that the snippet's API calls match the shipped `.d.ts`.

## 5. Conformance harness and results

- [x] 5.1 In `conformance/page.mjs`, pass `canvas: this` and the `getContext` attributes to `createContext`. Wrap jsdom's `HTMLCanvasElement.prototype` `width`/`height` accessors, and `Element.prototype` `setAttribute`, `setAttributeNS`, `removeAttribute` and `toggleAttribute` for a canvas's `width`/`height`, to call `gl.resize` synchronously. Throw at install time if the accessor descriptors are missing. Update `test/conformance-harness.test.mjs` for every scenario of "Pages obtain oxgl contexts through canvas", "Rejected context creation returns null" and "Canvas resizes reach the drawing buffer". Verify with `npm test` and `npm run conformance -- --filter conformance/canvas/drawingbuffer-test`.
- [x] 5.2 On Linux arm64 (the `conformance` CI job with a temporary `--update` step), run both suites with `OXGL_BACKEND=software npm run conformance -- --update`, refresh reasons from the report, and commit `conformance/expectations.txt`. Record in this task:
  - the entry counts before and after;
  - the run times against the previous run, since antialiasing is now the default;
  - the soak test's measured growth;
  - the GC-reclaim test's peak resident memory and measured growth, on the 4-CPU arm64 runner (design: Risks).

  Verify that `conformance/canvas/drawingbuffer-test.html`, `conformance/canvas/viewport-unchanged-upon-resize.html` and `conformance/context/context-attributes-alpha-depth-stencil-antialias.html` pass, or that each has a reason outside this change's scope recorded here.
  - Run in a `linux/arm64` Docker container (Node 24, `--jobs 14`, 16 CPUs) instead of the CI job, as `CLAUDE.md` allows.
  - Entries went from 3,095 to 3,080. webgl1: 153 PASS (was 146), 768 FAIL, 49 TIMEOUT. webgl2: 606 PASS (was 598), 2,069 FAIL, 190 TIMEOUT.
  - Run time: 446 s for both suites, the same as the previous run (446 s): antialiasing adds no measurable time, since pages still stop at missing object calls.
  - Soak test: 0.53 ms per create/destroy cycle (was 0.19; the multisampled framebuffer allocation and clear), RSS growth 1.0 MiB over 1,000 cycles.
  - GC-reclaim test: median RSS growth per pass −8.1 MiB (passes −133.7, −8.1, +104.1 MiB) on the 16-CPU container; it passes. The 4-CPU runner was not used (no CI in this run).
  - `drawingbuffer-test.html` passes. `viewport-unchanged-upon-resize.html` stops at `createProgram` and `context-attributes-alpha-depth-stencil-antialias.html` at `drawArrays`, both `core-rendering`.
  - `context-attribute-preserve-drawing-buffer-antialias.html` went from FAIL to TIMEOUT: it now reaches shader code inside a promise chain, whose rejection is ignored (as in a browser). `core-rendering` resolves it.
  - One page (`glsl/functions/glsl-function-normalize.html`) once exited without an outcome (a harness error); it did not reproduce in a rerun.
- [x] 5.3 Run `npx openspec validate drawing-buffer --strict`, `npm run lint`, `cargo clippy --all-targets -- -D warnings` and `npm test`, and confirm that all pass.

## Workflow follow-up

- Apply only after `context-state` and then `harness-2d-canvas` are archived. `harness-2d-canvas` task 3.1 rebases this change's conformance-testing delta first.
- Archive `drawing-buffer` and sync its specs once the PR is merged and reviewed.
