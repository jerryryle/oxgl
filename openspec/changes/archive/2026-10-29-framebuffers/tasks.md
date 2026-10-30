# Tasks

## 1. Native

- [x] 1.1 In `oxgl-sys`, add the framebuffer, renderbuffer, blit, draw/read buffer, invalidation, clear-buffer, internal-format and pack-buffer read entry points. Verify with clippy pedantic.
- [x] 1.2 In `oxgl-core`, add `Framebuffer` and `Renderbuffer` objects, the default-framebuffer mapping (binding, deletion fallback, draw/read buffers, status, attachment queries), WebGL 1's lists, resolving blits, and pack-buffer reads. Add Rust tests for the WebGL 1 lists and the `BACK`/`NONE` mapping. Verify with `cargo test -p oxgl-core` on Linux arm64 (Docker).

## 2. Binding and JS layer

- [x] 2.1 Add the `oxgl-node` exports, bump `native_abi_version`, and add `WebGLFramebuffer`, `WebGLRenderbuffer`, binding and attachment bookkeeping and every method of the proposal to the TS layer. Add `test/framebuffers.test.mjs` with every scenario of the `framebuffers` delta and the `context-state` and `pixel-readback` scenarios, and type checks. Verify with `OXGL_BACKEND=software npm test` on Linux arm64 (Docker) and `npm run lint`.

## 3. Conformance results

- [x] 3.1 On Linux arm64 (Docker), run both suites with `--update`, refresh reasons, commit `conformance/expectations.txt`, and record counts and the largest remaining failure groups.
  - Run in a `linux/arm64` Docker container (Node 24, `--jobs 14`), 413 s; 235 reasons refreshed. This run also made WebIDL operations enumerable, which deqp's context wrapper needs.
  - Entries went from 758 to 495. webgl1: 907 PASS (was 819), 36 FAIL, 28 TIMEOUT. webgl2: 2,434 PASS (was 2,262), 399 FAIL, 32 TIMEOUT.
  - Largest remaining groups: TIMEOUT 60; transform feedback 44, uniform blocks 25, vertex arrays 10, queries 5, instancing 9 (`webgl2-objects`); `img.decode` 5 (harness); then many single-page failures.
  - Review findings fixed after the run: `readBuffer(NONE)` on the antialiased drawing buffer, the `DEPTH_STENCIL_ATTACHMENT` name query with different depth and stencil objects.
- [x] 3.2 Run `npx openspec validate framebuffers --strict`, `npm run lint`, clippy and `npm test`, and confirm that all pass.
