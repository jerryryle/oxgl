# Proposal

## Why

WebGL 1's `ANGLE_instanced_arrays` requires `INVALID_OPERATION` when an instanced attribute the current program reads would be fetched past the end of its buffer (WebGL 1.0 §6.6). ANGLE checks this itself only on backends without robust buffer access. On its Vulkan backend (SwiftShader, and Vulkan GPU drivers on Linux) the fetch is safe but no error is reported, so Khronos `conformance/extensions/angle-instanced-arrays-out-of-bounds.html` failed. ANGLE's Metal backend reports the error.

## What Changes

- WebGL 1 instanced draws check each enabled attribute with a nonzero divisor and a buffer: if `offset + ⌊(instances − 1) / divisor⌋ × stride + element size` exceeds the buffer's size and the current program reads that location, the draw generates `INVALID_OPERATION` and draws nothing.
- WebGL 2 is unchanged: robust buffer access behavior is allowed there, and the conformance tests accept it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `drawing`.

## Impact

- `crates/oxgl-core/src/webgl2.rs`. No ABI change. One divisor query per attribute on each WebGL 1 instanced draw; the rest only for instanced attributes.
