# Tasks

## 1. State setters

- [x] 1.1 Add `Current` methods in `oxgl-sys`, with `// SAFETY:` comments, for every setter in the context-state "State setters", "Capabilities enable and disable" and "Viewport and scissor" requirements, plus `glIsEnabled`, `glPixelStorei`, `glFlush` and `glFinish`. Add the matching `Context` methods in `oxgl-core` (forwarded to ANGLE without validation; design) and `#[napi]` exports, and bump `native_abi_version` to 3. Verify with `cargo clippy --all-targets -- -D warnings`.
- [x] 1.2 In `oxgl-core`, add `UnpackState` for `UNPACK_FLIP_Y_WEBGL`, `UNPACK_PREMULTIPLY_ALPHA_WEBGL` and `UNPACK_COLORSPACE_CONVERSION_WEBGL`. `pixelStorei` stores those three and forwards every other parameter. Add Rust unit tests for the initial values (colorspace `BROWSER_DEFAULT_WEBGL`), the stored values, and `INVALID_VALUE` on a bad colorspace value. Verify with `cargo test -p oxgl-core`.
- [x] 1.3 Add the setters, `isEnabled`, `pixelStorei`, `flush` and `finish` to `ContextBase` in `src/context.ts`, with WebIDL conversion, argument-count `TypeError`s and lost-context no-ops. Create `test/context-state.test.mjs` with the scenarios of "Capabilities enable and disable", "State methods convert arguments per WebIDL" and "State methods on a lost context" that check results through `isEnabled` and `getError` only. Add the "flush and finish" scenario to `test/drawing.test.mjs`. Verify with `OXGL_BACKEND=software npm test`.

## 2. State queries

- [x] 2.1 Add robust boolean, float, integer and int64 getters and `glGetShaderPrecisionFormat` to `oxgl-sys`. Each writes only into Rust-owned arrays and passes their size as `bufSize`. Verify with clippy pedantic.
- [x] 2.2 Build the `getParameter` table in `oxgl-core`, covering every non-extension parameter of WebGL 1.0 §5.14.3 and WebGL 2.0 §3.7.2 with kind, count and version. Implement lookup as the design describes: unknown or wrong-version → `INVALID_ENUM`, `Object` → null, `Shadow` → `UnpackState`, version strings, `length == 0` → `None`. Add Rust tests for one parameter of each kind, for the unknown, WebGL 2-on-1 and extension cases, and for the version strings. Add a test that every table pname appears in `src/generated/webgl-constants.ts` for its version. Verify with `cargo test`.
- [x] 2.3 Export `getParameter`, `getShaderPrecisionFormat` and `isContextLost` from `oxgl-node`. In TS, build the JS values from `{ kind, numbers, text }`, and add `WebGLShaderPrecisionFormat` (not constructible, read-only attributes, exported) and `isContextLost`. Also add `getSupportedExtensions`/`getExtension` as TS-only placeholders. Add to `test/context-state.test.mjs` every scenario of "getParameter …", "getShaderPrecisionFormat", "State setters", "WebGL-specific state rules", "Viewport and scissor", "Pixel storage parameters" and "WebGL-only unpack parameters". Also add the parts of "State methods convert arguments per WebIDL" and "State methods on a lost context" that 1.3 could not check: the `colorMask` result through `COLOR_WRITEMASK`, the unchanged `VIEWPORT` after the `TypeError`, and `getParameter` returning `null` after destroy. Add the `isContextLost` scenarios to `test/error-reporting.test.mjs` (using `lose_context` for device loss, as existing tests do) and the extension scenarios to a new `test/extensions.test.mjs`. Add `WebGLShaderPrecisionFormat` and the `getParameter` return type to `test/types.ts`. Verify with `npm run lint` and `OXGL_BACKEND=software npm test`.

## 3. readPixels and pack parameters

- [x] 3.1 Generalize `pixels::required_bytes` to the OpenGL ES 3.0 §4.3.2 layout (alignment, row length, skip pixels, skip rows), and have `Context::read_pixels` read the pack parameters from GL on each call. Remove `PACK_ALIGNMENT`. Add Rust unit tests for the layout arithmetic, including overflow. Add every scenario of the modified "readPixels into an ArrayBufferView" and "Format and type validation" requirements to `test/pixel-readback.test.mjs`. Verify with `cargo test` and `OXGL_BACKEND=software npm test`.

## 4. Conformance results

- [x] 4.1 On Linux arm64 (the `conformance` CI job with a temporary `--update` step, as `webgl-idl-constants` task 3.1 did), run both suites with `OXGL_BACKEND=software npm run conformance -- --update`, refresh reasons from the report, and commit `conformance/expectations.txt`. Record the entry counts before and after. Verify that `conformance/state/gl-get-calls.html`, `gl-initial-state.html` and `conformance/extensions/get-extension.html` pass, or that each has a reason not in this change's scope recorded here.
  - Run in a `linux/arm64` Docker container (Node 24, `--jobs 8`) instead of the CI job, as `CLAUDE.md` allows. Reasons were refreshed from the reports with `reasonFor`.
  - Entries went from 3,159 to 3,097 (WebGL 1: 827, WebGL 2: 2,270).
  - webgl1: 144 PASS (was 79), 779 FAIL, 48 TIMEOUT, in 169 s. webgl2: 595 PASS (was 491), 2,081 FAIL, 189 TIMEOUT, in 599 s.
  - 121 pages went from FAIL to TIMEOUT. They now get past the state calls and then hang in the runner: the `textures/video`, `textures/image` and `textures/webgl_canvas` groups and others built on `wtu.dispatchPromise`. The cause is jsdom's `postMessage` delivering `source: null`, plus no 2D canvas or images. `harness-2d-canvas` addresses them.
  - `conformance2/wasm/multi-draw-2gb-in-4gb-wasm-memory.html` now passes in both runs and has no entry.
  - The named pages:
    - `gl-initial-state.html` and `extensions/get-extension.html` pass.
    - `state/gl-get-calls.html` gets past every `getParameter` check and fails at `getVertexAttrib`, which belongs to the shaders and vertex-attribute work.
- [x] 4.2 Group the remaining failure reasons and record the largest groups in this task as input for ordering the next changes. Confirm that no group is a missing member this change was meant to add.
  - `createShader` 672, `createProgram` 582, `createTexture` 435.
  - `undefined` reading `width` (`gl.canvas`) 421: `drawing-buffer`.
  - TIMEOUT 237.
  - `createBuffer` 111.
  - A null 2D context: `createImageData` 85, `getImageData` 70, `drawImage` 8. `harness-2d-canvas` addresses these.
  - `createFramebuffer` 28.
  - `undefined` reading `addEventListener` (`gl.canvas`) 10.
  - `getInternalformatParameter` 8, `getContextAttributes` 5 (`drawing-buffer`), `getFramebufferAttachmentParameter` 4.
  - No group is a member this change adds. The four reasons that name one have other causes:
    - `zero-sized-canvas.html` gets a `null` context because 0×0 is rejected (`drawing-buffer`).
    - Two dEQP pages call `viewport` on dEQP's own context object, not oxgl's.
- [x] 4.3 Run `npx openspec validate context-state --strict`, `npm run lint`, `cargo clippy --all-targets -- -D warnings` and `npm test`, and confirm that all pass.

## Workflow follow-up

- Archive `context-state` and sync its specs once the PR is merged and reviewed, before `drawing-buffer` is applied.
