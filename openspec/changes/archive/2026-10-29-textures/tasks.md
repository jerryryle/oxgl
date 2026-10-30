# Tasks

## 1. Native

- [x] 1.1 In `oxgl-sys`, add the texture and sampler entry points (robust upload and getter variants, value calls through the `calls.rs` macros). Verify with clippy pedantic and a test that samples an uploaded texture on ES2 and ES3 SwiftShader (done through the Node tests, which drive the same entry points on both versions).
- [x] 1.2 In `oxgl-core`, add `Texture` and `Sampler` objects, view-type checks, unpack layout arithmetic, the pixel codec (decode/encode for every WebGL 1 and WebGL 2 unsized and sized upload format/type), flip, premultiply and the `TexImageSource` conversion. Add Rust unit tests for the layout arithmetic (with overflow), the codec round trips of each format/type, flip and premultiply. Verify with `cargo test -p oxgl-core` on Linux arm64 (Docker).

## 2. Binding and JS layer

- [x] 2.1 Add the `oxgl-node` exports, bump `native_abi_version`, and add `WebGLTexture`, `WebGLSampler`, per-unit bindings, `TexImageSource` extraction and every method of the proposal to the TS layer. Add `test/textures.test.mjs` with every scenario of the `textures` delta and the `context-state` scenario, and type checks to `test/types.ts`. Verify with `OXGL_BACKEND=software npm test` on Linux arm64 (Docker) and `npm run lint`.

## 3. Conformance results

- [x] 3.1 On Linux arm64 (Docker), run both suites with `OXGL_BACKEND=software npm run conformance -- --update` and commit `conformance/expectations.txt`, recording counts before and after and the largest remaining failure groups.
  - Run in a `linux/arm64` Docker container (Node 24, `--jobs 14`), 442 s for both suites; 504 stale reasons refreshed from the report.
  - Entries went from 1,739 to 758. webgl1: 819 PASS (was 706), 110 FAIL, 42 TIMEOUT. webgl2: 2,262 PASS (was 1,392), 556 FAIL, 47 TIMEOUT.
  - Largest remaining groups: `createFramebuffer`/`bindFramebuffer`/`createRenderbuffer` and other framebuffer calls ~180 (`framebuffers`); `context.clearColor`/`context.useProgram is not a function` 133 (deqp's reference context, to investigate); TIMEOUT 86; transform feedback 43, uniform blocks 25, vertex arrays 10, queries 4, instancing 6 (WebGL 2 objects); `img.decode` 5 (harness).
  - Review findings fixed after the run: premultiplied canvas sources, the canvas readback's pack state and errors, and flips of depth uploads. Known limitation: uploading a canvas that has no context yet creates a 2D context on it (Node offers no other way to read it).
- [x] 3.2 Run `npx openspec validate textures --strict`, `npm run lint`, `cargo clippy --all-targets -- -D warnings` and `npm test`, and confirm that all pass.
