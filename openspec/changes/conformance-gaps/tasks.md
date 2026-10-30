# Tasks

## 1. Implementation

- [x] 1.1 `oxgl-core`: flagged shader/program slots and sweeps; location link check; bound-texture check per target use; texture parameter list for setters; integer premultiply and sRGB formats in the codec; WebGL 1 empty-attachment check; color-attachment maximum; WebGL 2 primitive restart. Verify with clippy pedantic and `cargo test` on Linux arm64 (Docker).
- [x] 1.2 JS layer: liveness of deleted shaders/programs from native code; `OBJECT_NAME` on empty WebGL 1 points. Tests in `test/webgl-objects.test.mjs`, `test/shaders-programs.test.mjs`, `test/framebuffers.test.mjs`.

## 2. Conformance results

- [ ] 2.1 On Linux arm64 (Docker), run both suites with `--update` and record counts.
