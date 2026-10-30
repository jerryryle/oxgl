# Proposal

## Why

Several remaining Khronos failures came from the runner's DOM behaving unlike a browser, or from a rule oxgl can apply without a browser:

- jsdom has no `Worker`, so `context-release-with-workers.html` never started, and `typed-arrays-in-workers.html` skipped its worker tests.
- jsdom fires a window's `load` event again when images created after the first load finish, so `<body onload>` ran twice. That broke `tex-image-with-format-and-type.html`.
- Cross-origin images were accepted as texture sources, and 2D canvases that drew them stayed readable. Browsers refuse both (WebGL 1.0 §4.2, HTML §4.12.5.1.7).

## What Changes

- **Origin-clean images (oxgl)**: uploading a document image fetched from another origin without CORS throws a `SecurityError`. An image's origin is compared with its document's URL; `data:` and `blob:` URLs, images with `crossOrigin` set, and hosts without document URLs are clean.
- **Tainted 2D canvases (runner)**: a 2D canvas that draws a cross-origin image, or a tainted canvas, is tainted. Its `getImageData` and `toDataURL` throw `SecurityError`, which an upload from it propagates.
- **Workers (runner)**: dedicated workers for classic scripts on Node worker threads, with `postMessage`, `onmessage`, `close` and `terminate`. Messages reaching the page are rebuilt in its realm. There is no `importScripts`, WebGL or `OffscreenCanvas` in workers.
- **One load event (runner)**: a window's `load` event reaches the page once.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `conformance-testing`, `textures`.

## Impact

- `src/context.ts`, `conformance/page.mjs`. No ABI change.
