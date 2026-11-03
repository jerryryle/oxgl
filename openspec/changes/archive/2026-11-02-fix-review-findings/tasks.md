# Tasks

## 1. Canvas readback ignores the read buffer

- [x] 1.1 Add the color-read pair to `DrawingBuffer` (`crates/oxgl-core/src/drawing_buffer.rs`) as design.md decision 1 describes, and switch `drawing_buffer_rgba8` (`crates/oxgl-core/src/textures.rs`) to it. Verify with `cargo clippy --workspace --all-targets -- -D warnings` (pedantic, as `npm run lint:rust` runs it).
- [x] 1.2 Add the `pixel-readback` scenario "Read buffer NONE" to `test/pixel-readback.test.mjs`, with and without `antialias`. It checks the PNG's pixels, `getParameter(READ_BUFFER)`, and the `INVALID_OPERATION` of `readPixels`. It then checks that after `readBuffer(BACK)`, `readPixels` returns red with `NO_ERROR`, which catches a restore that left the antialiased resolve FBO's read buffer at `NONE` (design.md decision 1). Verify that it fails on the current code and passes after 1.1.
- [x] 1.3 Add the `textures` scenario "Canvas whose read buffer is NONE" to `test/textures.test.mjs`. Verify that it fails on the current code (the texture samples black) and passes after 1.1.

## 2. Detached buffer sources

- [x] 2.1 In `src/context.ts` `byteRange`, return an empty `Uint8Array` with the converted offsets for a detached source (design.md decision 2). Verify with `npm run lint:js`.
- [x] 2.2 Add the `buffers` scenarios "Detached source", "Detached source of bufferSubData (WebGL 2)" and "Range on a detached source (WebGL 2)" to `test/buffers.test.mjs`. Verify that they throw on the current code and pass after 2.1.

## 3. GL state follows accepted calls

- [x] 3.1 Add the core helper that reports whether a GL call raised an error (design.md decision 3). Use it in `renderbuffer_storage` (`crates/oxgl-core/src/framebuffers.rs`) so `depth_stencil` changes only on success. Verify with clippy pedantic.
- [x] 3.2 Add the `framebuffers` scenarios "Rejected DEPTH_STENCIL storage" and "Rejected storage after DEPTH_STENCIL" to `test/framebuffers.test.mjs`. Verify that they fail on the current code and pass after 3.1.
- [x] 3.3 Make `link_program` (`crates/oxgl-core/src/rendering.rs`) use the helper and return whether the link was attempted, dropping `uniform_types` only then. Have the `linkProgram` binding (`crates/oxgl-node/src/rendering.rs`) return that `bool`. Update `src/load-native.ts` and increment `linkCount` in `src/context.ts` only on `true`. Bump `native_abi_version` and `NATIVE_ABI_VERSION` to 14, and update the `nativeAbiVersion` assertion in `test/load.test.mjs` to 14. Verify with `npm run build`, `npm run lint` and `node --test test/load.test.mjs`.
- [x] 3.4 Add the `shaders-programs` scenario "Link rejected during transform feedback (WebGL 2)" to `test/shaders-programs.test.mjs`. Check that the existing "Location from an earlier link" test still passes. Verify that the new test fails on the current code and passes after 3.3.

## 4. Cleanups

- [x] 4.1 Remove the unreachable second `offset < 0` check from `buffer_sub_data`, and make `has_object` make the context current once instead of in each arm (`crates/oxgl-core/src/rendering.rs`). Verify that `cargo test --workspace` and the `is*` tests in `test/webgl-objects.test.mjs` and `test/webgl2-objects.test.mjs` pass unchanged.

## 5. Integration

- [x] 5.1 Run `npm run lint` and `npm test` on macOS arm64. Then run the Khronos pages for the touched areas, one invocation per area, and verify that each prints `conformance: ok` (no failures beyond `conformance/expectations.txt`). `--filter` matches a substring of the page path, so `conformance/` does not match `conformance2/`. The `conformance/…` areas omit `--suite`, so they run under both suites: the WebGL 2 suite runs those pages too. The `webgl_canvas` pages upload WebGL canvases through the readback changed in group 1, and `conformance/programs/` relinks programs and reuses their locations (group 3).
  - `npm run conformance -- --filter conformance/buffers/`
  - `npm run conformance -- --filter conformance/renderbuffers/`
  - `npm run conformance -- --filter conformance/uniforms/`
  - `npm run conformance -- --filter conformance/programs/`
  - `npm run conformance -- --filter conformance/textures/misc/`
  - `npm run conformance -- --filter conformance/textures/webgl_canvas/`
  - `npm run conformance -- --suite webgl2 --filter conformance2/buffers/`
  - `npm run conformance -- --suite webgl2 --filter conformance2/renderbuffers/`
  - `npm run conformance -- --suite webgl2 --filter conformance2/transform_feedback/`
  - `npm run conformance -- --suite webgl2 --filter conformance2/textures/webgl_canvas/`
- [x] 5.2 Validate with `npx openspec validate fix-review-findings --strict`.

## Workflow follow-up

- Linux arm64 and the other platforms are covered by the pull request's CI. Per CLAUDE.md, a macOS result does not stand in for Linux arm64.
- Archive the change once it is reviewed and CI passes.
