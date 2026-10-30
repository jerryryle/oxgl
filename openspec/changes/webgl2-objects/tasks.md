# Tasks

## 1. Native

- [ ] 1.1 In `oxgl-sys`, add the vertex array, instancing, indexed binding, uniform block, transform feedback, query and sync entry points, with `SyncHandle`. Verify with clippy pedantic.
- [ ] 1.2 In `oxgl-core`, add the `VertexArray`, `TransformFeedback`, `Query` and `Sync` objects and their methods. Verify with `cargo test -p oxgl-core` on Linux arm64 (Docker).

## 2. Binding and JS layer

- [ ] 2.1 Add the `oxgl-node` exports, bump `native_abi_version`, and add the object classes, per-vertex-array and per-transform-feedback mirrors, the turn-based availability of query and sync results, and every method of the proposal to the TS layer. Add `test/webgl2-objects.test.mjs` with every scenario of the deltas, and type checks. Verify with `OXGL_BACKEND=software npm test` on Linux arm64 (Docker) and `npm run lint`.

## 3. Conformance results

- [ ] 3.1 On Linux arm64 (Docker), run both suites with `--update`, refresh reasons, commit `conformance/expectations.txt`, and record counts and the largest remaining failure groups.
- [ ] 3.2 Run `npx openspec validate webgl2-objects --strict`, `npm run lint`, clippy and `npm test`, and confirm that all pass.
