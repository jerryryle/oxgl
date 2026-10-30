# Tasks

## 1. Drawing buffer

- [x] 1.1 `DrawingBuffer::present` clears without `preserveDrawingBuffer`, keeping state, indexed color masks and bindings; native `presentDrawingBuffer`, ABI 11.
- [x] 1.2 Node tests: compositing clears only without `preserveDrawingBuffer`; per-draw-buffer color masks survive.

## 2. Runner

- [x] 2.1 `compositeEachFrame` presents the document's WebGL canvases before each animation frame's callbacks.
- [x] 2.2 Runner server: no keep-alive timeout.
- [x] 2.3 Default parallelism bounded by memory.

## 3. Uploads

- [x] 3.1 `srcOffset` past the view: `INVALID_OPERATION`.

## 4. Verification

- [x] 4.1 Full conformance run with `--update`: WebGL 1 953/971, WebGL 2 2847/2865 (from 948 and 2840).
