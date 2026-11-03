## ADDED Requirements

### Requirement: Reading half-float and sRGB drawing buffers
Wherever oxgl reads the drawing buffer as 8-bit RGBA for `encodePNG` or for an upload of its canvas, an `RGBA16F` drawing buffer SHALL be read as floats, clamped to `[0, 1]` and rounded to 8 bits. An `SRGB8_ALPHA8` drawing buffer SHALL be read as its stored 8-bit values, without converting them to linear.

#### Scenario: Half-float buffer as a PNG
- **WHEN** a WebGL 2 context with `RGBA16F` storage is cleared to `(2.0, 0.5, -1.0, 1.0)` and the awaited `encodePNG(gl)` is decoded
- **THEN** its pixel is `[255, 128, 0, 255]` within one unit

#### Scenario: sRGB buffer uploaded to another context
- **WHEN** context A with `SRGB8_ALPHA8` storage is cleared to the linear equivalent of `(64, 32, 16) / 255`, opaque, and context B uploads `A.canvas`
- **THEN** B's texture samples `[64, 32, 16, 255]` within one unit (cf. Khronos `conformance2/canvas/drawingbuffer-storage-test.html`, "Drawing opaque SRGB8_ALPHA8 to canvas")

### Requirement: Unpremultiplying half-float and sRGB drawing buffers
When that read is of a premultiplied drawing buffer, an `RGBA16F` buffer's colors SHALL be divided by alpha before rounding to 8 bits, and an `SRGB8_ALPHA8` buffer's stored, encoded values SHALL be divided by alpha as they are.

#### Scenario: Semi-transparent half-float buffer
- **WHEN** a premultiplied WebGL 2 context with `RGBA16F` storage is cleared to `(0.005, 0.005, 0.005, 0.01)` and the awaited `encodePNG(gl)` is decoded
- **THEN** its pixel is `[128, 128, 128, 3]` within two units

#### Scenario: Semi-transparent sRGB buffer
- **WHEN** a premultiplied WebGL 2 context with `SRGB8_ALPHA8` storage is cleared to the linear equivalent of `(32, 64, 16) / 255` with alpha `64 / 255`, and context B uploads its canvas
- **THEN** B's texture samples `[128, 255, 64, 64]` within five units (Khronos `conformance2/canvas/drawingbuffer-storage-test.html`, "Drawing transparent SRGB8_ALPHA8 to canvas")

### Requirement: PNG color space
`encodePNG` SHALL mark the PNG of a drawing buffer whose `drawingBufferColorSpace` is `"display-p3"` with a `cICP` chunk giving Display P3 primaries, the sRGB transfer function and full-range RGB (colour primaries 12, transfer characteristics 13, matrix coefficients 0, video full range 1; the `cICP` chunk of PNG, Third Edition). A PNG of an `"srgb"` drawing buffer SHALL carry no color-space chunk, as before.

#### Scenario: Display P3 PNG
- **WHEN** a context sets `drawingBufferColorSpace` to `"display-p3"`, clears, and the awaited `encodePNG(gl)` is parsed
- **THEN** it has a `cICP` chunk with bytes `[12, 13, 0, 1]`, before its `IDAT` chunk

#### Scenario: sRGB PNG
- **WHEN** a context with the default color space is encoded
- **THEN** the PNG has no `cICP`, `iCCP`, `sRGB` or `gAMA` chunk
