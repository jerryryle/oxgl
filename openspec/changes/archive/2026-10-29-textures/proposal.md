# Proposal

## Why

`createTexture` is the largest remaining failure group after `core-rendering` (435 pages before it), and every three.js material with a map, every render target and every post-processing pass needs textures. WebGL 2 samplers belong with them: three.js does not use samplers, but WebGL 2 pages that sample textures do.

## What Changes

- **Texture objects** (WebGL 1.0 §5.14.8, WebGL 2.0 §3.7.6): `WebGLTexture`, `createTexture`, `bindTexture`, `deleteTexture`, `isTexture`, `texParameterf/i`, `getTexParameter`, `generateMipmap`, and the texture bindings of `getParameter` per texture unit.
- **Uploads from `ArrayBufferView`**: `texImage2D`, `texSubImage2D` and, on WebGL 2, `texImage3D`, `texSubImage3D`, with the WebGL 2 `srcOffset` forms and the pixel-unpack-buffer (`GLintptr pboOffset`) forms. The view type must match the pixel type (WebGL 1.0 §5.14.8), and the view must hold the bytes the unpack parameters require.
- **Unpack parameters**: `UNPACK_FLIP_Y_WEBGL` and `UNPACK_PREMULTIPLY_ALPHA_WEBGL` apply to every 2D upload, `ArrayBufferView` included (WebGL 1.0 §5.14.3 `pixelStorei`), by converting the pixels on the CPU before ANGLE sees them. On WebGL 2 they generate `INVALID_OPERATION` for 3D uploads from views and pixel unpack buffers (WebGL 2.0 §5.36).
- **`TexImageSource` in Node**: objects shaped like `ImageData` (`width`, `height`, `data`), canvases with a 2D context (`getContext('2d').getImageData`, as node-canvas and jsdom provide), images from a document (drawn through `ownerDocument.createElement('canvas')`), and oxgl contexts' canvases (read back from the drawing buffer). Pixels are converted from RGBA8 to the requested format and type, as browsers do (WebGL 1.0 §5.14.8, WebGL 2.0 §3.7.6 table).
- **Copies and storage**: `copyTexImage2D`, `copyTexSubImage2D` (resolving an antialiased drawing buffer first), WebGL 2's `copyTexSubImage3D`, `texStorage2D`, `texStorage3D`.
- **Compressed textures**: `compressedTexImage2D/3D` and `compressedTexSubImage2D/3D` entry points with size checks; formats come only from extensions (`extensions` change), so until then every format is `INVALID_ENUM`.
- **Samplers** (WebGL 2.0 §3.7.13): `WebGLSampler`, `createSampler`, `deleteSampler`, `isSampler`, `bindSampler`, `samplerParameterf/i`, `getSamplerParameter`, and `SAMPLER_BINDING`.
- Conformance expectations are regenerated.

## Capabilities

### New Capabilities

- `textures`: texture and sampler objects, uploads, unpack parameters, `TexImageSource` handling, copies, immutable storage and the compressed-texture entry points (WebGL 1.0 §5.14.8, WebGL 2.0 §3.7.6, §3.7.13).

### Modified Capabilities

- `context-state`: `getParameter` returns texture objects for `TEXTURE_BINDING_2D`, `TEXTURE_BINDING_CUBE_MAP` and, on WebGL 2, `TEXTURE_BINDING_3D`, `TEXTURE_BINDING_2D_ARRAY` for the active unit, and the sampler for `SAMPLER_BINDING`.

## Impact

- `crates/oxgl-sys`: texture and sampler entry points, robust upload and getter variants.
- `crates/oxgl-core`: `Texture` and `Sampler` objects, unpack-size computation, CPU pixel conversion (flip, premultiply, RGBA8 to every WebGL format/type).
- `crates/oxgl-node`, `src/`: exports, `WebGLTexture`, `WebGLSampler`, per-unit binding bookkeeping.
- `conformance/page.mjs`: none expected; images already decode through jsdom and node-canvas.

## Out of Scope and Extension Points

- **Video, `ImageBitmap` and `VideoFrame` sources.** Node has none; a source that is none of the supported shapes throws `TypeError`, as an unsupported type does in WebIDL.
- **Color-space conversion** (`UNPACK_COLORSPACE_CONVERSION_WEBGL`): sources are taken as sRGB RGBA8, with nothing to convert, whatever its value.
- **Compressed formats and float/half-float texture extensions** (`extensions` change).
- **Framebuffer attachments of textures** (`framebuffers` change). Rendering to a texture needs both.
