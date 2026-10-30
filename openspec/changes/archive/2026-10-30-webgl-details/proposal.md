# Proposal

## Why

The last API-level Khronos failures came from WebGL rules that ANGLE does not apply in oxgl's setup: WebGL 1 depth textures (ANGLE enables its GL depth textures by default), WebGL 1's own `DEPTH_STENCIL_ATTACHMENT` point, WebGL 2's table of `TexImageSource` formats, unpack row lengths on oxgl's own repack path, WebGL 1 calls with an extra argument, and arrays built in Node's main realm reaching pages in another realm.

## What Changes

- **WebGL 1 depth textures**: `DEPTH_COMPONENT`/`DEPTH_STENCIL` uploads need `WEBGL_depth_texture` (`INVALID_ENUM` before) and are then `TEXTURE_2D` level 0 without data only (`INVALID_OPERATION` otherwise, and for `texSubImage2D`).
- **`DEPTH_STENCIL_ATTACHMENT`**: on WebGL 1 a point of its own; on WebGL 2 the depth and stencil points, named only when the same object is at both.
- **TexImageSource formats**: integer formats only with `UNSIGNED_BYTE` (WebGL 2.0 §3.7.6).
- **Unpack rows**: a row (the row length, or the width when 0) shorter than `width + UNPACK_SKIP_PIXELS` is `INVALID_OPERATION` (WebGL 2.0 §5.35), on every upload path.
- **Arguments and realms**: WebGL 1 ignores a tenth `texImage2D` argument; arrays returned to JS are created by the JS layer, in the caller's realm.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `textures`, `framebuffers`, `node-api`.

## Impact

- `crates/oxgl-core` (`textures.rs`, `codec.rs`, `framebuffers.rs`), `src/context.ts`. No ABI change.
