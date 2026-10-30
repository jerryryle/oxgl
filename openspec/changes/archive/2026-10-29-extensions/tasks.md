# Tasks

## 1. Native

- [x] 1.1 Probe ANGLE's requestable extensions on ES2 and ES3 SwiftShader (Linux arm64, Docker) and fix the extension table's GL names from it. Add the extension entry points to `oxgl-sys`. Verify with clippy pedantic.
- [x] 1.2 In `oxgl-core`, add the extension table, the enabled set per context, the version-dependent entry points for vertex arrays, instancing and draw buffers, the WebGL 1 list growth, and the extension `getParameter` rows. Add Rust tests for the table (every row's version and names) and name matching. Verify with `cargo test -p oxgl-core` on Linux arm64 (Docker).

## 2. Binding and JS layer

- [x] 2.1 Add the exports, bump `native_abi_version`, and add the extension classes and objects to the TS layer. Add `test/extensions.test.mjs` scenarios for every requirement of the deltas, and type checks. Verify with `OXGL_BACKEND=software npm test` on Linux arm64 (Docker) and `npm run lint`.

## 3. Conformance results

- [x] 3.1 On Linux arm64 (Docker), run both suites with `--update`, refresh reasons, commit `conformance/expectations.txt`, and record counts and the largest remaining failure groups.
- [x] 3.2 Run `npx openspec validate extensions --type change --strict`, `npm run lint`, clippy and `npm test`, and confirm that all pass.

## Results

Linux arm64 (Docker), software backend: WebGL 1 907 of 971 pages pass, WebGL 2 2767 of 2865. Extension pages that only checked an extension's absence now exercise it; the remaining extension failures are accepted or open: instanced draws past the end of a buffer do not generate `INVALID_OPERATION` (ANGLE skips that validation under robust buffer access, and reads zeros instead), `preserveDrawingBuffer: false` pages expect compositing to clear the buffer (a headless buffer is never presented). Two failures that looked unrelated had the same kind of cause: a WebGL 1 attachment past `MAX_COLOR_ATTACHMENTS_WEBGL` reached ANGLE, whose error came with a second one from the attachment query that followed, and `TexImageSource` uploads did not know `EXT_sRGB`'s formats.
