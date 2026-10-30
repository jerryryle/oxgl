# Tasks

## 1. Native building blocks

- [ ] 1.1 In `oxgl-sys`, add the GLES entry points for buffers, shaders, programs, uniforms, vertex attributes and draw calls through the `calls.rs` macros, with slice-taking wrappers for pointer arguments and robust variants for getters. Add `ReadSource` to `napi_view` (borrowed bytes for non-shared buffers, an atomic copy for shared ones). Verify with `cargo clippy --all-targets -- -D warnings` and an `oxgl-sys` test that compiles, links and draws a triangle on ES2 and ES3 SwiftShader.
- [ ] 1.2 In `oxgl-core`, add the `Buffer`, `Shader` and `Program` object variants, `Deferred::Object` in the runtime queue, buffer target compatibility, uniform array-length checks, byte-range computation for `srcOffset`/`length`, and `getUniform`'s getter selection. Add Rust tests for target compatibility, range arithmetic (including overflow), deferred deletion of an object whose context is gone, and array-length checks. Verify with `cargo test -p oxgl-core` on Linux arm64 (Docker).

## 2. Binding and JS layer

- [ ] 2.1 Add the `oxgl-node` exports and bump `native_abi_version`. Split `src/context.ts` into `webidl.ts`, `objects.ts` and `context.ts`, and teach `conformance/page.mjs` to inline local modules. Verify with `npm run lint:js` and `npm test` (the harness tests evaluate the inlined layer).
- [ ] 2.2 Add the object classes, ownership and deletion checks, binding bookkeeping, the finalization registry and every method of the proposal to the TS layer. Add `test/buffers.test.mjs`, `test/shaders-programs.test.mjs` and `test/webgl-objects.test.mjs` with every scenario of the `webgl-objects`, `buffers` and `shaders-programs` deltas, and add the `drawing` and `context-state` scenarios to `test/drawing.test.mjs` and `test/context-state.test.mjs`. Add the classes and method signatures to `test/types.ts`. Verify with `OXGL_BACKEND=software npm test` on Linux arm64 (Docker) and `npm run lint`.

## 3. Conformance results

- [ ] 3.1 On Linux arm64 (Docker), run both suites with `OXGL_BACKEND=software npm run conformance -- --update`, refresh reasons, and commit `conformance/expectations.txt`. Record the PASS/FAIL/TIMEOUT counts per suite before and after, and the largest remaining failure groups as input for the next changes. Verify that `conformance/buffers/*`, `conformance/programs/program-test.html`, `conformance/rendering/simple.html` and `conformance/attribs/gl-vertexattribpointer.html` pass, or record why not.
- [ ] 3.2 Run `npx openspec validate core-rendering --strict`, `npm run lint`, `cargo clippy --all-targets -- -D warnings` and `npm test`, and confirm that all pass.
