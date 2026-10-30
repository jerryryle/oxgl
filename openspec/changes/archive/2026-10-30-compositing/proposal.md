# Proposal

## Why

Several Khronos pages check what a browser does to a WebGL canvas between frames: without `preserveDrawingBuffer`, compositing clears the drawing buffer (WebGL 1.0 §2.2). The runner never composited, so those pages failed. One WebGL 2 page also expects `INVALID_OPERATION`, not `INVALID_VALUE`, for a `srcOffset` past the end of a texture source view.

## What Changes

- **Presenting a drawing buffer**: an internal `presentDrawingBuffer(gl)` in the JS layer clears the drawing buffer as compositing does, unless `preserveDrawingBuffer` is set. Clear state, masks (indexed ones included), scissor, rasterizer discard and bindings are kept. It is not part of the public API: headless contexts are never composited.
- **Runner compositing**: at the start of each animation frame the runner presents every WebGL canvas that is in the document, as a browser does.
- **Runner connections**: the runner's server no longer closes idle connections after five seconds; a page that ran synchronously longer than that had its next script request reset and timed out.
- **Runner parallelism**: the default number of pages run at once is also bounded by memory, one page per GiB; 16 pages on a 16-CPU, 8 GB machine swapped and timed out.
- **Upload offsets**: a `srcOffset` past the end of the view generates `INVALID_OPERATION`, like any view too small for the upload.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-creation`, `conformance-testing`, `textures`.

## Impact

- `crates/oxgl-core` (`drawing_buffer.rs`, `context.rs`, `textures.rs`), `crates/oxgl-node`, `src/context.ts`, `src/load-native.ts`, `conformance/page.mjs`, `conformance/server.mjs`, `conformance/pool.mjs`. Native ABI 10 → 11.
