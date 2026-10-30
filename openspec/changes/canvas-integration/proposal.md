# Proposal

## Why

Two groups of Khronos pages still failed for reasons outside WebGL calls: oxgl reallocated (and cleared) the drawing buffer when a canvas was set to the size it already had, where Chromium keeps it (`conformance/canvas/render-after-resize-test.html`), and the conformance runner's jsdom canvases showed nothing when a page drew a WebGL canvas into a 2D canvas or exported it with `toDataURL`, and its images had no `decode()`, so pages that await it hung.

## What Changes

- **Same-size resize keeps the buffer**: `resize`, and setting a canvas's `width` or `height`, to the size last requested leaves the drawing buffer and its contents as they are. This replaces the earlier "resize to the same size clears" scenario.
- **Runner**: a WebGL canvas drawn into a 2D canvas, or exported with `toDataURL`, shows its drawing buffer (unpremultiplied RGBA8, from the same native call `texImage2D` uses for canvas sources); `HTMLImageElement.decode()` resolves on load and rejects on error.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-creation`: drawing buffer resize.
- `conformance-testing`: the runner's canvas and image shims.

## Impact

- `crates/oxgl-core`: `DrawingBuffer::resize` skips an unchanged request.
- `src/context.ts`: `canvasPixels` for the runner.
- `conformance/page.mjs`: `drawImage`, `toDataURL` and `decode` shims.
