# Tasks

## 1. Implementation

- [x] 1.1 `DrawingBuffer::resize` keeps an unchanged request; update `test/drawing-buffer.test.mjs`. Verify on Linux arm64 (Docker).
- [x] 1.2 `canvasPixels` and the runner's `drawImage`, `toDataURL` and `decode` shims.

## 2. Conformance results

- [x] 2.1 On Linux arm64 (Docker), run both suites with `--update` and record counts.

## Results

Linux arm64 (Docker), software backend, with the `getUniform` fix that cleared the 36 `no-over-optimization-on-uniform-array` timeouts: WebGL 1 943 of 971 pages pass, WebGL 2 2825 of 2865 (from 914 and 2796).
