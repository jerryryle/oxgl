# Tasks

## 1. Native

- [ ] 1.1 In `oxgl-sys`, add the texture and sampler entry points (robust upload and getter variants, value calls through the `calls.rs` macros). Verify with clippy pedantic and an `oxgl-sys` test that samples an uploaded texture on ES2 and ES3 SwiftShader.
- [ ] 1.2 In `oxgl-core`, add `Texture` and `Sampler` objects, view-type checks, unpack layout arithmetic, the pixel codec (decode/encode for every WebGL 1 and WebGL 2 unsized and sized upload format/type), flip, premultiply and the `TexImageSource` conversion. Add Rust unit tests for the layout arithmetic (with overflow), the codec round trips of each format/type, flip and premultiply. Verify with `cargo test -p oxgl-core` on Linux arm64 (Docker).

## 2. Binding and JS layer

- [ ] 2.1 Add the `oxgl-node` exports, bump `native_abi_version`, and add `WebGLTexture`, `WebGLSampler`, per-unit bindings, `TexImageSource` extraction and every method of the proposal to the TS layer. Add `test/textures.test.mjs` with every scenario of the `textures` delta and the `context-state` scenario, and type checks to `test/types.ts`. Verify with `OXGL_BACKEND=software npm test` on Linux arm64 (Docker) and `npm run lint`.

## 3. Conformance results

- [ ] 3.1 On Linux arm64 (Docker), run both suites with `OXGL_BACKEND=software npm run conformance -- --update` and commit `conformance/expectations.txt`, recording counts before and after and the largest remaining failure groups.
- [ ] 3.2 Run `npx openspec validate textures --strict`, `npm run lint`, `cargo clippy --all-targets -- -D warnings` and `npm test`, and confirm that all pass.
