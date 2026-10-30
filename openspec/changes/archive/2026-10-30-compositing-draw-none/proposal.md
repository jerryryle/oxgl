# Proposal

## Why

Khronos `conformance/extensions/webgl-draw-buffers.html` sets the drawing buffer's draw buffer to `NONE` and expects compositing to clear it anyway. oxgl's clear honored the `NONE` draw buffer and left the buffer's contents. The same clear runs after a resize, which must also clear whatever the draw buffer is.

## What Changes

- The drawing buffer's internal clear (after compositing and after allocation) temporarily draws to the color attachment when the page set the draw buffer to `NONE`, then restores `NONE`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-creation`.

## Impact

- `crates/oxgl-core/src/drawing_buffer.rs`. No ABI change.
