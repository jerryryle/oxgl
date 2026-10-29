# Spec Delta

## MODIFIED Requirements

### Requirement: readPixels into an ArrayBufferView
`readPixels(x, y, width, height, format, type, pixels)` SHALL behave as specified in WebGL 1.0 §5.14.12 "Read Operations" and OpenGL ES 2.0 §4.3.1 (WebGL 2: the `ArrayBufferView` overload without `dstOffset` in WebGL 2.0 §4.7.10 "Reading back pixels", OpenGL ES 3.0 §4.3.2). Rows SHALL be written bottom-to-top as in OpenGL, laid out by the current `PACK_ALIGNMENT` and, on WebGL 2, `PACK_ROW_LENGTH`, `PACK_SKIP_PIXELS` and `PACK_SKIP_ROWS`.

#### Scenario: Read after clear
- **WHEN** the buffer is cleared to `(0, 1, 0, 1)` and `readPixels(0, 0, w, h, RGBA, UNSIGNED_BYTE, new Uint8Array(w*h*4))` is called
- **THEN** every pixel in the array is `[0, 255, 0, 255]` and `getError()` returns `NO_ERROR` (cf. Khronos `conformance/reading/read-pixels-test.html`)

#### Scenario: Exact required size
- **WHEN** a 3×2 region is read as RGBA/UNSIGNED_BYTE into a `Uint8Array(24)`, and again into a `Uint8Array(23)`
- **THEN** the first read succeeds and the second generates `INVALID_OPERATION` with the array unmodified (cf. Khronos `conformance/reading/read-pixels-pack-alignment.html`)

#### Scenario: Pack alignment changes the required size
- **WHEN** `pixelStorei(PACK_ALIGNMENT, 8)` is set and a 3×2 region is read as RGBA/UNSIGNED_BYTE into a `Uint8Array(28)`, and again into a `Uint8Array(27)`
- **THEN** the first read succeeds with the second row starting at byte 16, and the second read generates `INVALID_OPERATION` with the array unmodified

#### Scenario: WebGL 2 pack parameters
- **WHEN** a WebGL 2 context sets `PACK_ROW_LENGTH` to `4` and `PACK_SKIP_PIXELS` to `1`, then reads a 2×2 RGBA/UNSIGNED_BYTE region into a `Uint8Array(28)`
- **THEN** the read succeeds, the pixels land at bytes 4–11 and 20–27, and every other byte is unmodified (cf. Khronos `conformance2/reading/read-pixels-pack-parameters.html`)

### Requirement: Format and type validation
The `format`/`type` pair `RGBA`/`UNSIGNED_BYTE`, and the pair that `getParameter(IMPLEMENTATION_COLOR_READ_FORMAT)` and `getParameter(IMPLEMENTATION_COLOR_READ_TYPE)` report for the current framebuffer, SHALL be accepted. Other pairs SHALL generate the errors the WebGL and OpenGL ES specifications prescribe.

#### Scenario: Invalid enum
- **WHEN** `readPixels` is called with `format = 0x1234`
- **THEN** `getError()` returns `INVALID_ENUM` and the destination is unmodified

#### Scenario: Implementation read format
- **WHEN** `readPixels` reads one pixel using the format and type `getParameter` reports as the implementation read format, into a view of the matching type and size
- **THEN** `getError()` returns `NO_ERROR` (cf. Khronos `conformance/reading/read-pixels-test.html`)
