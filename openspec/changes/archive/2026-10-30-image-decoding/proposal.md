# Proposal

## Why

Five Khronos pages per version failed because the runner's images went through the canvas package. It premultiplies pixels, applies PNG gamma, cuts 16-bit images to 8 bits, and rasterizes SVGs at their natural size. A browser decodes an image for a WebGL upload without any of that (WebGL 1.0 §5.14.8, WebGL 2.0 §3.7.6). jsdom also reloaded an image when its `width` attribute changed, so a page's load handler ran again.

## What Changes

- **Image decoder hook (oxgl, internal)**: `setImageDecoder`, beside `canvasPixels` and `presentDrawingBuffer`, lets a host that has a document image's bytes return its pixels as browsers decode them for WebGL. Without a hook, or when it returns `undefined`, images go through a 2D canvas as before.
- **16-bit sources (oxgl)**: a `TexImageSource`'s pixels may be RGBA16 in a `Uint16Array`, encoded at full precision, so a 10-bit image uploads to `RGB10_A2` without being cut to 8 bits.
- **PNG in the runner**: a PNG decoder (zlib, no dependency) that ignores gamma and color profiles, keeps alpha unpremultiplied and keeps 16-bit samples. `toDataURL` of a WebGL canvas writes its unpremultiplied pixels as PNG. SVG images are rasterized at the element's size.
- **jsdom images in the runner**: a `width` change reloads an image only for responsive images (`srcset` or `sizes`), as Chromium does.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `textures`, `conformance-testing`.

## Impact

- `src/context.ts`, `crates/oxgl-core/src/{codec,textures}.rs`, `conformance/page.mjs`, new `conformance/png.mjs`. No ABI change: the native layer reads a `Uint16Array` source's element type from its view.
