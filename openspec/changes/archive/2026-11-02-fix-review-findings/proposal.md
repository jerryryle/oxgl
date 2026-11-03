# Proposal

## Why

A review of the codebase found four ways oxgl departs from WebGL in normal use. None is caught by oxgl's tests or by the pinned Khronos suite. In each case the nearby test stops just short of the wrong path. Two of the bugs lose output silently (a blank PNG) or throw where a browser does not.

## What Changes

- **Canvas readback ignores the read buffer.** `encodePNG(gl)` and uploads that use an oxgl canvas as their `TexImageSource` read the drawing buffer's color whatever the page set with WebGL 2's `readBuffer`. Today they return transparent black after `readBuffer(NONE)` on the default framebuffer. `readPixels` and `copyTex*` keep reporting `INVALID_OPERATION` in that state, as OpenGL ES 3.0 §4.3.1 and §3.8.5 require.
- **Detached sources do not throw.** `bufferData` and `bufferSubData` accept an `ArrayBuffer` or view whose buffer has been detached, and treat it as zero bytes, as browsers do. Today the call throws `TypeError` before it reaches the GL. With WebGL 2's `srcOffset`/`length`, a range past those zero bytes generates `INVALID_VALUE`, as for any short view.
- **The `DEPTH_STENCIL` alias follows the storage GL kept.** `getRenderbufferParameter(RENDERBUFFER_INTERNAL_FORMAT)` reports `DEPTH_STENCIL` only for a renderbuffer whose last successful `renderbufferStorage` named it. A call that GL rejected no longer changes what is reported.
- **A rejected link keeps uniform locations valid.** A `linkProgram` call that GL rejects without relinking keeps the program's earlier `WebGLUniformLocation`s valid, and keeps `getUniform`'s answers. GL rejects a link this way, for example, for a program that is active in transform feedback (OpenGL ES 3.0 §2.15.2). An attempted link, successful or failed, still invalidates them (WebGL 1.0 §5.14.10).
- Two small cleanups with no behavior change: a duplicate negative-offset check in native `bufferSubData`, and repeated make-current code in native `is*` queries.

Out of scope:

- A failed context creation during a restore leaves `restoreQueued` set, so later `restoreContext()` calls do nothing. That failure is a rare backend failure, and leaving the context lost is an accepted outcome, so this change does not handle it.
- Detached destinations of WebGL 2's `readPixels(…, dstOffset)` and of `getBufferSubData`. Those overloads build a sub-view in TS and so may also throw on a detached view. They are left for a later change, if one is wanted.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pixel-readback`: "Drawing buffer as a PNG" reads the drawing buffer's color whatever the read buffer.
- `textures`: adds "Canvas sources ignore the read buffer", for an oxgl canvas as a `TexImageSource`.
- `buffers`: adds "Detached buffer sources", which count as zero bytes.
- `framebuffers`: adds "DEPTH_STENCIL alias follows accepted storage", reported only for storage GL accepted.
- `shaders-programs`: adds "Rejected links keep uniform locations", invalidated only by a link GL attempted.

Each new behavior is its own requirement, leaving the existing ones untouched, so no requirement description grows past the length `openspec validate --specs --strict` allows. The `pixel-readback` change stays a MODIFIED requirement because it amends that requirement's own sentence about which buffer is read.

## Impact

- `crates/oxgl-core`: `textures.rs` (`drawing_buffer_rgba8`), `drawing_buffer.rs` (a read of the color attachment that ignores the page's read buffer), `framebuffers.rs` (`renderbuffer_storage`), `rendering.rs` (`link_program`, `buffer_sub_data`, `has_object`), and a shared helper that reports whether a GL call raised an error.
- `crates/oxgl-node`: `link_program` returns whether the link was attempted.
- `src/context.ts`: `byteRange` for detached sources, and `linkProgram`'s `linkCount`.
- `src/load-native.ts`: the `linkProgram` native signature (boolean result). This is a native ABI change, so `native_abi_version` is bumped.
- Tests in `test/` for each behavior. There are no API, dependency or packaging changes.
