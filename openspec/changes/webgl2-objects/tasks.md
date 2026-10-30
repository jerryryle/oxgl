# Tasks

## 1. Native

- [x] 1.1 In `oxgl-sys`, add the vertex array, instancing, indexed binding, uniform block, transform feedback, query and sync entry points, with `SyncHandle`. Verify with clippy pedantic.
- [x] 1.2 In `oxgl-core`, add the `VertexArray`, `TransformFeedback`, `Query` and `Sync` objects and their methods. Verify with `cargo test -p oxgl-core` on Linux arm64 (Docker).

## 2. Binding and JS layer

- [x] 2.1 Add the `oxgl-node` exports, bump `native_abi_version`, and add the object classes, per-vertex-array and per-transform-feedback mirrors, the turn-based availability of query and sync results, and every method of the proposal to the TS layer. Add `test/webgl2-objects.test.mjs` with every scenario of the deltas, and type checks. Verify with `OXGL_BACKEND=software npm test` on Linux arm64 (Docker) and `npm run lint`.

## 3. Conformance results

- [x] 3.1 On Linux arm64 (Docker), run both suites with `--update`, refresh reasons, commit `conformance/expectations.txt`, and record counts and the largest remaining failure groups.
- [x] 3.2 Run `npx openspec validate webgl2-objects --strict`, `npm run lint`, clippy and `npm test`, and confirm that all pass.

## Results

Linux arm64 (Docker), software backend: WebGL 1 907 of 971 pages pass, WebGL 2 2759 of 2865 (from 907 and 2434 before this change). Review and conformance fixes along the way: a deleted current program stays a program until replaced (deqp `lifetime.delete_used`), `QUERY_RESULT` is a number, uniform block queries need a linked program, `BACK`/`DEPTH`/`STENCIL` are not attachments of a framebuffer object, renderbuffer and texture parameter queries and WebGL 2 renderbuffer formats follow WebGL's lists rather than ANGLE's. The largest remaining failure groups are extension pages (the `extensions` change), timeouts of long pages on the software backend, and context loss and restore (`context-loss`).
