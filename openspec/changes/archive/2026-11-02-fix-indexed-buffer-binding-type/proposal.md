# Proposal

## Why

WebGL fixes a buffer's type the first time it is bound: element array, or any other target (WebGL 2.0 §5.1). WebGL 2's `bindBufferBase` and `bindBufferRange` record that type before ANGLE validates the call, and keep it when ANGLE rejects the call. A page that passes a misaligned `bindBufferRange` offset (an easy mistake with uniform buffers) or an out-of-range index ends up with a never-bound buffer that can no longer be bound as an element buffer, and that `isBuffer` reports as a buffer. A command that generates an error has no effect other than setting the error flag (OpenGL ES 3.0 §2.5), so a rejected bind should leave the buffer as it was.

## What Changes

- `bindBufferBase` and `bindBufferRange` record a never-bound buffer's type only when the binding took effect. A rejected call leaves the buffer untyped: a later `bindBuffer(ELEMENT_ARRAY_BUFFER, buffer)` succeeds, and `isBuffer(buffer)` stays `false` until a bind succeeds.
- A rejected `bindBufferBase` or `bindBufferRange` also leaves the generic binding as GL has it. Success is decided from the call's own GL error rather than by reading the indexed binding back, since that read-back matches when the same buffer is already bound at the index.
- Regression tests for an empty range, a misaligned offset and an out-of-range index. The empty range is invalid on every backend. The misaligned offset is derived from the queried `UNIFORM_BUFFER_OFFSET_ALIGNMENT`, and that case is skipped where the alignment is 1, since every offset is aligned there.

Out of scope: `bindBuffer` records the type the same way, but its target is checked before the GL call and no other rejection reaches ANGLE, so it is unaffected. There are no API, ABI or packaging changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `buffers`: adds "Rejected binds leave a buffer untyped" and "Rejected indexed binds keep the bindings".

## Impact

- `crates/oxgl-core/src/webgl2.rs`: `bind_buffer_indexed` checks the target rule without changing the buffer, and decides success with the `accepted` helper (`crates/oxgl-core/src/context.rs`) instead of reading the indexed binding back, and records the type only on success. The change adds no `unsafe` or panics; it trades the indexed-binding query for `glGetError` calls.
- `test/webgl2-objects.test.mjs`: the new scenarios.
