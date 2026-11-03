# Proposal

## Why

The WebGL specification at the pinned Khronos commit defines four drawing-buffer members that oxgl lacks: `drawingBufferFormat`, `drawingBufferStorage()`, `drawingBufferColorSpace` and `unpackColorSpace` (WebGL 1.0 §2.2 and §5.14.1). Chrome and Safari implement them. Code that uses them gets `undefined` under oxgl, and the README lists them under Known issues.

The conformance suite skips its tests for them while they are missing:
- `conformance/canvas/drawingbuffer-storage-test.html` and its WebGL 2 twin skip when `drawingBufferStorage` is absent.
- The 45 video upload pages add Display P3 cases only once `unpackColorSpace` exists.

Implementing the members turns those tests on, so they become this change's tests.

## What Changes

- **`drawingBufferFormat`** reports the drawing buffer's color format: `RGBA8`, or `RGB8` with `alpha: false`, until `drawingBufferStorage` changes it.
- **`drawingBufferStorage(sizedFormat, width, height)`** reallocates the drawing buffer in `RGBA8`, `SRGB8_ALPHA8` or `RGBA16F` at the given size and clears it. It generates the errors the conformance test expects:
  - `INVALID_OPERATION` with `alpha: false`;
  - `INVALID_ENUM` for a format the context can't render to, such as `RGBA16F` without `EXT_color_buffer_float`;
  - `INVALID_VALUE` above `MAX_RENDERBUFFER_SIZE`.

  Resizing afterwards keeps the format. Every drawing-buffer allocation, resizes included, gets a 1 GiB budget. A larger request falls back to single sampling and then to smaller sizes, as the spec allows. Without it, the conformance test's 8192×8192 antialiased request would take about 2.4 GB under SwiftShader. A half-float drawing buffer reads back with `RGBA`/`FLOAT`. `encodePNG` and uploads of the canvas into another context see its values clamped to 8 bits.
- **`drawingBufferColorSpace`** (`"srgb"` or `"display-p3"`) records the color space of the drawing buffer's values. Changing it reallocates and clears the buffer. `encodePNG` marks a Display P3 buffer's PNG with a `cICP` chunk, and the canvas uploads into other contexts as Display P3.
- **`unpackColorSpace`** (`"srgb"` or `"display-p3"`) sets the color space that `TexImageSource` uploads are converted into. Each source has a color space:
  - an `ImageData`-shaped object's `colorSpace` property, `"srgb"` when absent;
  - an oxgl canvas's `drawingBufferColorSpace`;
  - `"srgb"` for everything else.

  When the source's color space differs from `unpackColorSpace` and `UNPACK_COLORSPACE_CONVERSION_WEBGL` is `BROWSER_DEFAULT_WEBGL`, the pixels are converted before the format conversion. `NONE` skips the color-space conversion. The textures requirement that `UNPACK_COLORSPACE_CONVERSION_WEBGL` "has no effect" changes accordingly.
- **Docs:** the README's Known issues entry for these members is removed, and the TypeScript declarations gain the members and a `PredefinedColorSpace` type.

**Out of scope:**
- Color spaces other than `"srgb"` and `"display-p3"`.
- Honoring ICC profiles in decoded images, which the conformance runner already ignores.
- Converting a Display P3 WebGL canvas when the conformance runner draws it into a 2D canvas.
- Exposing a host-facing color space in `canvasPixels`. Hosts keep receiving raw values, and that is where the runner support could be added later.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `context-creation`: the drawing buffer's format becomes reportable and changeable through `drawingBufferFormat` and `drawingBufferStorage()`, and the buffer gains `drawingBufferColorSpace`.
- `textures`: `TexImageSource` uploads convert into `unpackColorSpace`, which `UNPACK_COLORSPACE_CONVERSION_WEBGL` can turn off.
- `pixel-readback`: `encodePNG` and canvas readback handle half-float and sRGB drawing buffers, and tag Display P3 PNGs.

## Impact

- **Native code:**
  - `oxgl-core`: the drawing buffer gains a chosen color format and a float readback path.
  - A new color-space conversion module, safe Rust.
  - The texture upload path takes the source and target color spaces.
  - `oxgl-node` exposes `drawingBufferStorage`.
- **JavaScript (`src/context.ts`):** the four members, the upload path, and the declarations. `src/png.ts` gains the `cICP` chunk.
- **Tests:** new Node tests for each scenario, and Rust unit tests for the conversion. The two `drawingbuffer-storage-test.html` pages and the 45 video upload pages start running their new cases in the conformance suites.
- **Unchanged:** no change to `unsafe` code, the handle model, or the published package layout.
