## 1. Drawing buffer format and storage

- [x] 1.1 In `drawing_buffer.rs`, store `color_format` (`RGBA8`/`RGB8` from `alpha` at creation), use it in `try_allocate` for the color and resolve renderbuffers, and keep it across `resize`. Add `DrawingBuffer::storage(format, width, height, errors)` that always reallocates, clears, and sets `size_request` to the stored size. Make the 1 GiB allocation budget real, counting each format's bytes per pixel. Verify with Rust tests: storage at a new format allocates and clears, `resize` keeps the format, a resize to the earlier canvas size after storage reallocates, an over-budget request falls back to single sampling, and the existing fallbacks still apply. Measure the peak memory and time of an 8192×8192 antialiased request with and without the budget, and record both in design.md.
- [x] 1.2 Add `Context::drawing_buffer_storage` with the checks design.md lists (`INVALID_OPERATION` for `alpha: false`, `INVALID_ENUM` for formats the enabled extensions don't allow, `INVALID_VALUE` above `MAX_RENDERBUFFER_SIZE`) and expose it, plus `reallocate`, through `oxgl-node`. Verify with Rust tests for each error and for `RGBA16F` accepted after enabling `EXT_color_buffer_float`.
- [x] 1.3 In `src/context.ts`, add `drawingBufferStorage(sizedFormat, width, height)` with WebIDL argument conversion, which does nothing on a lost or destroyed context, and `drawingBufferFormat` backed by a JavaScript cache set at creation, after storage, and on restore. Verify with Node tests for the context-creation scenarios: initial format, RGBA8, half-float and sRGB storage, resize keeps the format, resize back to the canvas's earlier size, the three errors, over the allocation budget, storage while lost, restore resets the format, and color spaces survive a restore.

## 2. Readback of half-float and sRGB buffers

- [x] 2.1 In `drawing_buffer_rgba8`, read an `RGBA16F` drawing buffer as `RGBA`/`FLOAT`, clamping to `[0, 1]` and rounding to 8 bits. Keep the `UNSIGNED_BYTE` read for the other formats. Verify with Node tests for the pixel-readback scenarios: half-float buffer as a PNG, and sRGB buffer uploaded to another context.

## 3. Color spaces

- [x] 3.1 Add `oxgl-core/src/color.rs`: in-place sRGB ↔ Display P3 conversion of RGBA8 and RGBA16 data (sRGB transfer function, CSS Color 4 matrices, clamping, alpha untouched). Verify with Rust unit tests: sRGB red → `[234, 51, 35]` and green → `[117, 251, 76]` within one unit, a round trip within two units for colors well inside both gamuts, and Display P3 green → sRGB `[0, 255, 0]`.
- [x] 3.2 Give `native.texUpload` source and target color-space arguments, and convert before flip, premultiply and format conversion when `UNPACK_COLORSPACE_CONVERSION_WEBGL` is `BROWSER_DEFAULT_WEBGL` and the color spaces differ. Verify with 3.4.
- [x] 3.3 In `src/context.ts`, add `drawingBufferColorSpace` and `unpackColorSpace` with WebIDL enumeration setters. A change of `drawingBufferColorSpace` reallocates through `native.reallocate`. Have `imagePixels` report each source's color space, and pass both color spaces to `texUpload`. Verify with 3.4.
- [x] 3.4 Add Node tests for the textures and context-creation color-space scenarios: valid and invalid values, a change clears the buffer, sRGB red into Display P3, same color space untouched, views not converted, conversion turned off, Display P3 `ImageData` into sRGB, the canvas of a Display P3 context, and an out-of-gamut color clamped. Add a conformance-harness test for the opaque `ImageBitmap` scenario. Verify that `node --test` passes them.

## 4. PNG color space

- [x] 4.1 In `src/png.ts`, write a `cICP` chunk `[12, 13, 0, 1]` after `IHDR` when the context's `drawingBufferColorSpace` is `"display-p3"`. Verify with Node tests that parse the chunks of a Display P3 PNG and of an sRGB PNG.

## 5. Declarations and docs

- [x] 5.1 Declare the four members and export `PredefinedColorSpace` from the package. Extend `test/types.ts` and the DOM-lib declarations fixture. Verify that `npm run lint:js` and the declarations test pass.
- [x] 5.2 Remove the README's "Some recent WebGL additions are missing" known issue and the intro's mention of missing members, and document `drawingBufferStorage` and the color spaces in a README section. Verify by reading the README against the specs.

## 6. Verification

- [x] 6.1 Run `npm run lint` and `npm test`, and confirm both pass.
- [x] 6.2 Run `npm run conformance` for both suites. Confirm that `conformance2/canvas/drawingbuffer-storage-test.html` (the WebGL 1 page, `conformance/canvas/drawingbuffer-storage-test.html`, is commented out of the pinned suite's test list, so it never runs), both `constants-and-properties` pages, and the video upload pages (now with their Display P3 cases) pass, with no other change in results against `conformance/expectations.txt`.
- [x] 6.3 Run `npm run threejs` and confirm the results match `threejs/expectations.txt`.
