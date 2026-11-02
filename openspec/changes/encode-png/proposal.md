# Proposal

## Why

Saving what a context rendered is the most common thing done after rendering headless, and oxgl leaves every caller to write it: `readPixels`, flip the rows (GL is bottom row first), unpremultiply alpha when `premultipliedAlpha` is true (the default), then find a PNG encoder. The flip and unpremultiply are easy to get wrong, and oxgl already does both internally for a WebGL canvas used as a `TexImageSource`.

## What Changes

- **A new export, `encodePNG(gl)`**, returns a `Promise` of a Node `Buffer` (typed as `Uint8Array`, so the package's declarations still need no Node types) holding a PNG of the context's drawing buffer: RGBA8, unpremultiplied, top row first, as a browser's `canvas.toDataURL('image/png')` would encode it. It reads the drawing buffer whatever framebuffer is bound, resolves an antialiased buffer, and leaves all context state and the `getError` queue unchanged.
- **The pixels are read when it is called; compression runs off the main thread.** Drawing, resizing or destroying the context afterwards does not change the result, and deflating a large buffer does not block the event loop.
- **A lost or destroyed context rejects** with an `Error` with a new `code`, `OXGL_CONTEXT_LOST`, since it has no drawing buffer to encode. A value that is not an oxgl context rejects with a `TypeError`.

### Out of scope

- A synchronous variant. ES modules can `await` at the top level, but CommonJS scripts and synchronous functions cannot, and must handle the promise with `.then()` or move into an `async` function. A synchronous variant can be added later beside it if that proves a burden.
- Other formats (JPEG, WebP). They are lossy or need a codec oxgl would have to bundle; callers can pass `encodePNG`'s output or `readPixels` data to an image library.
- Encoding options (compression level, filtering). The encoder uses Node's zlib with fixed settings; an options argument can be added later without breaking callers.
- Encoding a framebuffer object or arbitrary pixels. `readPixels` covers those.
- `toDataURL` or `toBlob` on `HeadlessCanvas`. These would be standard HTML canvas methods built on the same encoder, left for later.
- The test runners' own PNG encoder in `conformance/png.mjs`. They encode composed frames and OffscreenCanvas bitmaps, not a context's drawing buffer, so they keep it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pixel-readback`: adds encoding the drawing buffer as a PNG, and its errors.

## Impact

- `src/` gains the encoder and the export, with TypeScript declarations; no native change, since the existing internal drawing-buffer read already returns unpremultiplied RGBA8, top row first.
- `README.md` documents `encodePNG` and adds `OXGL_CONTEXT_LOST` to the error table.
- No new dependencies: Node's built-in `node:zlib`.
