# Proposal

## Why

Two image pages still timed out on both versions. `exif-orientation.html` needs `fetch`, `createImageBitmap` and `ImageBitmap` uploads, none of which jsdom provides. `tex-image-svg-image-no-natural-width-and-height.html` loads an SVG without `width` and `height`, which the canvas package refuses; a browser loads it with no natural size and draws it at the element's size.

## What Changes

- **Host image objects (oxgl)**: a `TexImageSource` that is none of oxgl's own kinds is offered to the internal image decoder before it is rejected, so a host's `ImageBitmap` uploads. A document image is offered to the decoder before its zero natural size is taken as empty, so an SVG without a natural size draws at the element's size.
- **ImageBitmap uploads (oxgl)**: pixels the decoder marks `asIs` (an `ImageBitmap`'s) upload without `UNPACK_FLIP_Y_WEBGL` and `UNPACK_PREMULTIPLY_ALPHA_WEBGL`, which do not apply to ImageBitmaps (WebGL 1.0 §5.14.8). They reach the native layer as a new upload kind: native ABI 11 → 12.
- **ImageBitmap in the runner**: `createImageBitmap` from a Blob, an image, ImageData or a canvas, with `imageOrientation: 'flipY'` and `premultiplyAlpha`, and `fetch` when jsdom has none. The ~375 `image_bitmap_*` pages, which skipped without `createImageBitmap`, now run. JPEGs are decoded by the canvas package, which applies EXIF orientation as browsers do.
- **SVG in the runner**: SVGs are rasterized from their bytes at the element's size. One without a size loads with no natural size instead of failing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `textures`, `conformance-testing`.

## Impact

- `src/context.ts`, `src/load-native.ts`, `crates/oxgl-core/src/textures.rs`, `crates/oxgl-node`, `conformance/page.mjs`. Native ABI 12.
