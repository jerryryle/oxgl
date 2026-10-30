# Tasks

## 1. Native

- [ ] 1.1 Probe ANGLE's requestable extensions on ES2 and ES3 SwiftShader (Linux arm64, Docker) and fix the extension table's GL names from it. Add the extension entry points to `oxgl-sys`. Verify with clippy pedantic.
- [ ] 1.2 In `oxgl-core`, add the extension table, the enabled set per context, the version-dependent entry points for vertex arrays, instancing and draw buffers, the WebGL 1 list growth, and the extension `getParameter` rows. Add Rust tests for the table (every row's version and names) and name matching. Verify with `cargo test -p oxgl-core` on Linux arm64 (Docker).

## 2. Binding and JS layer

- [ ] 2.1 Add the exports, bump `native_abi_version`, and add the extension classes and objects to the TS layer. Add `test/extensions.test.mjs` scenarios for every requirement of the deltas, and type checks. Verify with `OXGL_BACKEND=software npm test` on Linux arm64 (Docker) and `npm run lint`.

## 3. Conformance results

- [ ] 3.1 On Linux arm64 (Docker), run both suites with `--update`, refresh reasons, commit `conformance/expectations.txt`, and record counts and the largest remaining failure groups.
- [ ] 3.2 Run `npx openspec validate extensions --type change --strict`, `npm run lint`, clippy and `npm test`, and confirm that all pass.
