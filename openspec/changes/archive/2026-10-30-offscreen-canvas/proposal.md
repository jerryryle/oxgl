# Proposal

## Why

The 35 OffscreenCanvas pages passed only by skipping: the runner had no `OffscreenCanvas`, and workers had no WebGL. Their WebGL coverage (contexts on an OffscreenCanvas, in workers, `transferToImageBitmap`, context loss in workers, queries and syncs in workers) was never exercised. oxgl's contexts already work without a DOM, in the main thread and in worker threads, so the runner can provide what these pages need.

## What Changes

- **oxgl**:
  - The internal `presentDrawingBuffer(gl, always)` can clear with `preserveDrawingBuffer`, as `transferToImageBitmap` does. Native ABI 12 → 13.
  - `resize` and `destroy`, oxgl's own methods, are no longer enumerable: they are not WebIDL members, and pages enumerate a context's members.
- **Runner**:
  - `OffscreenCanvas` (`conformance/offscreen.mjs`) in pages and workers. WebGL contexts are oxgl's and 2D ones the canvas package's. It provides `transferToImageBitmap`, `convertToBlob` and `transferControlToOffscreen`; a transferred canvas is composited with its placeholder.
  - Workers (`conformance/workers.mjs`) load oxgl in their thread and have the WebGL interfaces, `OffscreenCanvas`, `ImageBitmap`, `ImageData`, `requestAnimationFrame`, nested workers, Blob URLs, and `importScripts` of the suite's files. ImageBitmaps cross threads as their pixels.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-creation`, `conformance-testing`.

## Impact

- `src/context.ts`, `src/load-native.ts`, `crates/oxgl-core/src/{context,drawing_buffer}.rs`, `crates/oxgl-node`, `conformance/{page,offscreen,workers}.mjs`. Native ABI 13.
