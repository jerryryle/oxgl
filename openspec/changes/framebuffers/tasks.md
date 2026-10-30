# Tasks

## 1. Native

- [ ] 1.1 In `oxgl-sys`, add the framebuffer, renderbuffer, blit, draw/read buffer, invalidation, clear-buffer, internal-format and pack-buffer read entry points. Verify with clippy pedantic.
- [ ] 1.2 In `oxgl-core`, add `Framebuffer` and `Renderbuffer` objects, the default-framebuffer mapping (binding, deletion fallback, draw/read buffers, status, attachment queries), WebGL 1's lists, resolving blits, and pack-buffer reads. Add Rust tests for the WebGL 1 lists and the `BACK`/`NONE` mapping. Verify with `cargo test -p oxgl-core` on Linux arm64 (Docker).

## 2. Binding and JS layer

- [ ] 2.1 Add the `oxgl-node` exports, bump `native_abi_version`, and add `WebGLFramebuffer`, `WebGLRenderbuffer`, binding and attachment bookkeeping and every method of the proposal to the TS layer. Add `test/framebuffers.test.mjs` with every scenario of the `framebuffers` delta and the `context-state` and `pixel-readback` scenarios, and type checks. Verify with `OXGL_BACKEND=software npm test` on Linux arm64 (Docker) and `npm run lint`.

## 3. Conformance results

- [ ] 3.1 On Linux arm64 (Docker), run both suites with `--update`, refresh reasons, commit `conformance/expectations.txt`, and record counts and the largest remaining failure groups.
- [ ] 3.2 Run `npx openspec validate framebuffers --strict`, `npm run lint`, clippy and `npm test`, and confirm that all pass.
