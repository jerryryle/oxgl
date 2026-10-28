# pixel-readback Specification

## Purpose
Covers reading pixels from the current framebuffer back into JavaScript memory via `readPixels`, including format/type validation, destination-buffer checks, and out-of-bounds behavior.

## Requirements

### Requirement: readPixels into an ArrayBufferView
`readPixels(x, y, width, height, format, type, pixels)` SHALL behave as specified in WebGL 1.0 §5.14.12 "Read Operations" and OpenGL ES 2.0 §4.3.1 (WebGL 2: the `ArrayBufferView` overload without `dstOffset` in WebGL 2.0 §4.7.10 "Reading back pixels", OpenGL ES 3.0 §4.3.2). Rows SHALL be written bottom-to-top as in OpenGL, honoring the default `PACK_ALIGNMENT` of 4.

#### Scenario: Read after clear
- **WHEN** the buffer is cleared to `(0, 1, 0, 1)` and `readPixels(0, 0, w, h, RGBA, UNSIGNED_BYTE, new Uint8Array(w*h*4))` is called
- **THEN** every pixel in the array is `[0, 255, 0, 255]` and `getError()` returns `NO_ERROR` (cf. Khronos `conformance/reading/read-pixels-test.html`)

#### Scenario: Exact required size
- **WHEN** a 3×2 region is read as RGBA/UNSIGNED_BYTE into a `Uint8Array(24)`, and again into a `Uint8Array(23)`
- **THEN** the first read succeeds and the second generates `INVALID_OPERATION` with the array unmodified (cf. Khronos `conformance/reading/read-pixels-pack-alignment.html`)
### Requirement: Format and type validation
The `format`/`type` pair `RGBA`/`UNSIGNED_BYTE` SHALL always be accepted for the default framebuffer. Other pairs SHALL generate the errors the WebGL and OpenGL ES specifications prescribe; until `getParameter` exposes an implementation-chosen read format, only the guaranteed pair is required to succeed.

#### Scenario: Invalid enum
- **WHEN** `readPixels` is called with `format = 0x1234`
- **THEN** `getError()` returns `INVALID_ENUM` and the destination is unmodified

### Requirement: Destination buffer checks
If the `ArrayBufferView` type does not match `type`, `readPixels` SHALL generate `INVALID_OPERATION`. If the view is too small for the requested region, it SHALL generate `INVALID_OPERATION`. In WebGL 1, a `null` destination SHALL generate `INVALID_VALUE`. A destination that is not an `ArrayBufferView` or `null` SHALL throw a `TypeError` per WebIDL. In every error case the destination SHALL be unmodified.

#### Scenario: Wrong view type
- **WHEN** `readPixels(0, 0, 1, 1, RGBA, UNSIGNED_BYTE, new Float32Array(4))` is called
- **THEN** `getError()` returns `INVALID_OPERATION`

#### Scenario: Destination too small
- **WHEN** a 2×2 RGBA/UNSIGNED_BYTE read targets a `Uint8Array(15)`
- **THEN** `getError()` returns `INVALID_OPERATION` and the array is unmodified

#### Scenario: Null destination in WebGL 1
- **WHEN** a WebGL 1 context calls `readPixels(0, 0, 1, 1, RGBA, UNSIGNED_BYTE, null)`
- **THEN** `getError()` returns `INVALID_VALUE`

#### Scenario: Non-view destination
- **WHEN** `readPixels` is called with a plain JS array as destination
- **THEN** a `TypeError` is thrown

### Requirement: Negative dimensions
A negative `width` or `height` SHALL generate `INVALID_VALUE` (OpenGL ES 2.0 §2.5, negative `sizei` arguments).

#### Scenario: Negative width
- **WHEN** `readPixels(0, 0, -1, 1, RGBA, UNSIGNED_BYTE, new Uint8Array(4))` is called
- **THEN** `getError()` returns `INVALID_VALUE`

### Requirement: Reading outside the framebuffer
Pixels of the requested region that lie outside the framebuffer SHALL be left untouched in the destination, as specified in WebGL 1.0 §6.11 "Reading Pixels Outside the Framebuffer" and WebGL 2.0 §5.1.7 "Out-of-bounds Behaviors in copyTexSubImage2D and readPixels calls"; pixels inside SHALL be written normally.

#### Scenario: Partially outside region
- **WHEN** a 4×4 buffer cleared to white is read at `(-2, -2, 4, 4)` into a `Uint8Array` pre-filled with `7`
- **THEN** the 2×2 in-bounds pixels are white and every other byte is still `7`

### Requirement: Destination memory is not retained
The implementation SHALL NOT access the destination's memory after `readPixels` returns, and SHALL tolerate the destination's buffer being detached or garbage-collected immediately afterward.

#### Scenario: Shared destination
- **WHEN** `readPixels` targets a `Uint8Array` view on a `SharedArrayBuffer` while a worker writes to another region of that buffer
- **THEN** the read succeeds with the same pixel data as for an unshared view, and no crash occurs

#### Scenario: Buffer transferred after read
- **WHEN** `readPixels` completes and the destination's `ArrayBuffer` is then transferred via `structuredClone(buf, { transfer: [buf] })`
- **THEN** no crash or memory error occurs

### Requirement: Readback constants
The context instances and their constructors SHALL expose, with WebGL IDL values, `RGBA` and `UNSIGNED_BYTE`.

#### Scenario: Constant values
- **WHEN** `gl.RGBA` and `gl.UNSIGNED_BYTE` are read
- **THEN** they equal `0x1908` and `0x1401`
