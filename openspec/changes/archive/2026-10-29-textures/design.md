# Design

## Context

- `core-rendering` established the object model (slotmap handles, TS-side binding references, deferred deletion), `ReadSource`/`ByteSource` for typed-array input, and byte ranges computed in TS from `BYTES_PER_ELEMENT`.
- ANGLE's robust upload entry points (`glTexImage2DRobustANGLE` and friends, `GL_ANGLE_robust_client_memory`) take the client buffer's size and generate `INVALID_OPERATION` instead of reading past it, using the current unpack parameters. ANGLE in WebGL-compatibility mode also validates format/type/internal-format combinations, texture target compatibility, immutable storage and the WebGL 2 pixel-unpack-buffer rules.
- `UnpackState` in `oxgl-core` already stores `UNPACK_FLIP_Y_WEBGL`, `UNPACK_PREMULTIPLY_ALPHA_WEBGL` and `UNPACK_COLORSPACE_CONVERSION_WEBGL`; ANGLE owns every other unpack parameter.
- In the conformance runner, images decode through jsdom and node-canvas, and pages can draw them into 2D canvases.

## Goals / Non-Goals

**Goals:** every texture and sampler entry point of both versions, browser-identical results for the unpack parameters on every source, and `TexImageSource` uploads from what Node programs and the conformance pages actually have.

**Non-Goals:** video, `ImageBitmap`, color management, compressed formats (no extension yet).

## Decisions

### Objects and bindings

`Object` gains `Texture { name }` and `Sampler { name }`. The TS layer keeps, per texture unit, the texture bound to each target, plus the active unit and, on WebGL 2, the sampler per unit. `activeTexture` updates the mirrored unit only when `TEXTURE0 + i` is in range (`MAX_COMBINED_TEXTURE_IMAGE_UNITS`, read once at creation); otherwise ANGLE generates `INVALID_ENUM` and nothing changes. `bindTexture` and `bindSampler` return whether GL accepted the binding (the native call compares the binding query afterwards), as `bindBuffer` does, so a target mismatch that ANGLE rejects leaves the mirror unchanged. `deleteTexture` clears the texture from every unit, as GL does for the current context.

### ANGLE validates uploads; oxgl checks what it cannot see

For `ArrayBufferView` uploads, `oxgl-core` checks that the view's type matches the pixel type (WebGL 1.0 §5.14.8, WebGL 2.0 §3.7.6 table: e.g. `Uint16Array` for `UNSIGNED_SHORT_5_6_5`, `Float32Array` for `FLOAT`, `Uint16Array` for `HALF_FLOAT`) and generates `INVALID_OPERATION` otherwise. The bytes go to the robust entry point with their length, so ANGLE checks the size against the unpack parameters and never reads past the view. A `null` view allocates zero-filled storage (robust resource initialization).

### Flip and premultiply on the CPU

When `UNPACK_FLIP_Y_WEBGL` or `UNPACK_PREMULTIPLY_ALPHA_WEBGL` is set for a 2D upload from a view, `oxgl-core`:

1. computes the source layout from the unpack parameters (alignment, row length, skip pixels/rows; OpenGL ES 3.0 §3.7.2), reading those from GL as `readPixels` reads the pack parameters;
2. copies the rows tightly packed, last row first when flipping, premultiplying each pixel with the format's codec;
3. uploads with `UNPACK_ALIGNMENT` 1 and the other unpack parameters at 0, then restores them.

Chromium does the same. The premultiply codec decodes a pixel of each normalized or float format/type to four floats and encodes it back; integer formats are left unchanged (they have no normalized alpha). On WebGL 2, either flag with a 3D or 2D-array upload from a view or with a pixel unpack buffer generates `INVALID_OPERATION` (WebGL 2.0 §5.36).

### TexImageSource

The TS layer turns a source into RGBA8, unpremultiplied, top row first:

| Source | How |
|---|---|
| `ImageData` shape (`width`, `height`, `data` an `ArrayBufferView` of `width × height × 4` bytes) | as is |
| an oxgl context's canvas (`HeadlessCanvas`, or a canvas object passed as `canvas`) | `readPixels` of its drawing buffer, flipped to top-first |
| an object with `getContext('2d')` (node-canvas, jsdom `HTMLCanvasElement`) | `getImageData` of its whole area |
| an object with `ownerDocument` and natural size (`HTMLImageElement`) | drawn into `ownerDocument.createElement('canvas')`'s 2D context, then `getImageData` |

Anything else throws `TypeError`, the WebIDL result for an argument of no overload's type. An image that has not loaded (`naturalWidth` 0) uploads a 0×0 image, as browsers do for a broken image. `oxgl-core` converts the RGBA8 pixels to the requested format and type with the encoders the premultiply codec uses (WebGL 1.0 §5.14.8's and WebGL 2.0 §3.7.6's source combinations), applies flip and premultiply, and uploads with neutral unpack parameters. `UNPACK_COLORSPACE_CONVERSION_WEBGL` has no effect: every source is already sRGB RGBA8. On WebGL 2 a bound pixel unpack buffer makes a `TexImageSource` upload `INVALID_OPERATION`.

*Alternative:* depending on node-canvas to decode images. That adds a 53 MB native dependency to the package for a feature most Node users replace with `DataTexture`; the duck-typed route covers node-canvas when the user has it.

### Copies from an antialiased drawing buffer

`copyTexImage2D`, `copyTexSubImage2D` and `copyTexSubImage3D` call `DrawingBuffer::begin_read`/`end_read` around the GL call, as `readPixels` does, so they read the resolved buffer.

### Safety rules

- **Unsafe confinement:** new GL calls are `Current` methods in `oxgl-sys`; pointer-taking uploads use the robust variants with slice lengths.
- **No panics:** layout arithmetic uses checked operations; overflow generates `INVALID_VALUE` or `OUT_OF_MEMORY` as the GL would.
- **Handle model:** textures and samplers are slotmap objects like buffers.
- **ArrayBuffer lifetime:** views are read through `ReadSource` for the call only; converted pixels live in Rust-owned buffers.

## Risks / Trade-offs

- [CPU conversion cost for flipped or premultiplied uploads] → It runs only when a flag is set or the source is a `TexImageSource`, as in browsers. Plain view uploads go straight to ANGLE.
- [`getImageData` of a 2D canvas returns unpremultiplied data rounded by the 2D implementation] → Browsers have the same rounding; conformance pages allow for it.
