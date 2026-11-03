## MODIFIED Requirements

### Requirement: Drawing buffer format and initial contents
The drawing buffer SHALL have an RGBA8 color buffer when `alpha` is `true` and an RGB8 one without alpha when it is `false`, until `drawingBufferStorage` changes it, and `drawingBufferFormat` SHALL report the current one (WebGL 1.0 §2.2, §5.14.1). It SHALL have a depth buffer of at least 16 bits only when `depth` is `true`, and a stencil buffer of at least 8 bits only when `stencil` is `true` (WebGL 1.0 §2.2, §5.2.1). It SHALL initially contain zeros, with depth `1.0`. A headless context is never presented, so its contents SHALL persist until overwritten.

#### Scenario: Initial contents are zero
- **WHEN** `readPixels` reads the whole buffer of a freshly created context
- **THEN** every byte is `0`

#### Scenario: Initial format
- **WHEN** `drawingBufferFormat` is read on a context with default attributes and on one created with `alpha: false`
- **THEN** it is `RGBA8` (`0x8058`) and `RGB8` (`0x8051`) respectively (cf. Khronos `conformance/canvas/drawingbuffer-storage-test.html`)

#### Scenario: Alpha channel is present
- **WHEN** the buffer is cleared with alpha `0.5` and read back as RGBA/UNSIGNED_BYTE
- **THEN** the alpha byte is `127` or `128`

#### Scenario: No alpha channel
- **WHEN** a context created with `attributes: { alpha: false }` is cleared with alpha `0.5` and read back as RGBA/UNSIGNED_BYTE
- **THEN** the alpha byte is `255`, and `getParameter(ALPHA_BITS)` is `0` (cf. Khronos `conformance/context/context-attributes-alpha-depth-stencil-antialias.html`)

#### Scenario: Depth and stencil on request
- **WHEN** contexts are created with `{ depth: false, stencil: true }`, with `{ depth: true, stencil: true }` and with no attributes, and `getParameter(DEPTH_BITS)` and `getParameter(STENCIL_BITS)` are read on each
- **THEN** they are `0` and at least `8` for the first, at least `16` and at least `8` for the second, and at least `16` and `0` for the third

#### Scenario: Contents persist between calls
- **WHEN** the buffer is cleared, then `readPixels` is called twice with no intervening drawing
- **THEN** both reads return identical data

### Requirement: Requests that cannot be met
`depth`, `stencil` and `antialias` set to `true` SHALL be requests that the context MAY be unable to meet (WebGL 1.0 §2.2). When a buffer cannot be allocated, the context SHALL be created without it, and `getContextAttributes()` SHALL report it absent. A drawing-buffer allocation, at creation, on resize or by `drawingBufferStorage`, whose renderbuffers would take more than 1 GiB across all samples SHALL be treated as one that cannot be allocated: first single-sampled, then smaller.

#### Scenario: No multisampling available
- **WHEN** a context is created with the default `antialias: true` on a backend whose `MAX_SAMPLES` is 0
- **THEN** creation succeeds, `getContextAttributes().antialias` is `false` and `getParameter(SAMPLES)` is `0`

#### Scenario: Over the allocation budget
- **WHEN** a software-backend context with default attributes calls `drawingBufferStorage(RGBA8, 8192, 8192)`, which with 4 samples and depth would take more than 2 GiB
- **THEN** no error is generated, the drawing buffer is 8192×8192, and `getParameter(SAMPLES)` is `0`

## ADDED Requirements

### Requirement: drawingBufferStorage
`drawingBufferStorage(sizedFormat, width, height)` SHALL reallocate the drawing buffer in `sizedFormat` at `width`×`height`, clamped and cleared as a resize is, keeping `antialias` and all other state (WebGL 1.0 §2.2). `RGBA8` SHALL always be accepted. `SRGB8_ALPHA8` SHALL be accepted on WebGL 2 and with `EXT_sRGB` enabled. `RGBA16F` SHALL be accepted with `EXT_color_buffer_float` or `EXT_color_buffer_half_float` enabled. A later resize SHALL keep the format.

#### Scenario: RGBA8 storage
- **WHEN** a context calls `drawingBufferStorage(RGBA8, 16, 32)`, clears to `(16, 32, 64, 128) / 255` and reads a pixel as `RGBA`/`UNSIGNED_BYTE`
- **THEN** no error is generated, `drawingBufferFormat` is `RGBA8`, the drawing buffer is 16×32, and the pixel is `[16, 32, 64, 128]` (cf. Khronos `conformance/canvas/drawingbuffer-storage-test.html`)

#### Scenario: Half-float storage
- **WHEN** a WebGL 2 context enables `EXT_color_buffer_float`, calls `drawingBufferStorage(RGBA16F, 18, 28)`, clears to `(0.25, 0.5, 0.75, 0.125)` and reads a pixel as `RGBA`/`FLOAT`
- **THEN** the pixel is `[0.25, 0.5, 0.75, 0.125]` (cf. Khronos `conformance2/canvas/drawingbuffer-storage-test.html`)

#### Scenario: sRGB storage
- **WHEN** a WebGL 2 context calls `drawingBufferStorage(SRGB8_ALPHA8, 16, 32)`, clears to the linear equivalent of `(64, 16, 32) / 255` with alpha `128 / 255`, and reads a pixel as `RGBA`/`UNSIGNED_BYTE`
- **THEN** the pixel is `[64, 16, 32, 128]` within one unit

#### Scenario: Resize keeps the format
- **WHEN** a context with `RGBA16F` storage is resized with `resize(8, 8)`
- **THEN** `drawingBufferFormat` is still `RGBA16F` and the drawing buffer is 8×8

#### Scenario: Resize back to the canvas's earlier size
- **WHEN** a 16×16 `HeadlessCanvas` context calls `drawingBufferStorage(RGBA8, 32, 32)` and then sets `gl.canvas.width = 16`
- **THEN** the drawing buffer is 16×16, the canvas's size, in `RGBA8`

### Requirement: drawingBufferStorage errors
`drawingBufferStorage` SHALL generate `INVALID_OPERATION` on a context created with `alpha: false`, `INVALID_ENUM` for a format the context does not accept, and `INVALID_VALUE` for a width or height above `MAX_RENDERBUFFER_SIZE`, and leave the drawing buffer unchanged in each case. A size within `MAX_RENDERBUFFER_SIZE` that cannot be allocated SHALL give a smaller buffer without an error, as a resize does.

#### Scenario: No alpha
- **WHEN** a context created with `alpha: false` calls `drawingBufferStorage(RGBA8, 16, 16)`
- **THEN** `INVALID_OPERATION` is generated

#### Scenario: Extension not enabled
- **WHEN** a WebGL 2 context that has not enabled `EXT_color_buffer_float` calls `drawingBufferStorage(RGBA16F, 16, 16)`
- **THEN** `INVALID_ENUM` is generated

#### Scenario: Above the maximum
- **WHEN** a context calls `drawingBufferStorage(RGBA8, max, max)` with `max` from `getParameter(MAX_RENDERBUFFER_SIZE)`, then `drawingBufferStorage(RGBA8, max + 1, 16)`
- **THEN** the first call generates no error and gives a buffer of at most `max`×`max`, and the second generates `INVALID_VALUE` and leaves that size unchanged

### Requirement: Drawing buffer storage after context loss
`drawingBufferStorage` on a lost or destroyed context SHALL do nothing. A context restored after a loss SHALL have a drawing buffer in its initial format, `RGBA8` or `RGB8`, whatever `drawingBufferStorage` set before the loss (WebGL 1.0 §5.15.3). `drawingBufferColorSpace` and `unpackColorSpace` SHALL keep their values across a loss and a restore, and can be set while lost.

#### Scenario: Restore resets the format
- **WHEN** a context with `RGBA16F` storage is lost through `WEBGL_lose_context` and restored
- **THEN** `drawingBufferFormat` is `RGBA8`

#### Scenario: Storage while lost
- **WHEN** a lost context calls `drawingBufferStorage(RGBA8, 4, 4)`
- **THEN** nothing changes, and after the first `getError()` returns `CONTEXT_LOST_WEBGL` no further error is reported

#### Scenario: Color spaces survive a restore
- **WHEN** a context sets both color spaces to `"display-p3"` and is lost and restored
- **THEN** both still read `"display-p3"`

### Requirement: drawingBufferColorSpace
`drawingBufferColorSpace` SHALL start as `"srgb"` and accept `"srgb"` or `"display-p3"`. An assignment of any other value SHALL be ignored, as WebIDL does for enumeration attributes. Changing the value SHALL reallocate and clear the drawing buffer, and assigning the current value SHALL change nothing (WebGL 1.0 §5.14.1). The value SHALL set the color space of the drawing buffer when it is encoded or uploaded.

#### Scenario: Valid and invalid values
- **WHEN** a new context's `drawingBufferColorSpace` is read, set to `"display-p3"`, then set to `"rec2020"`
- **THEN** it reads `"srgb"`, then `"display-p3"`, and still `"display-p3"` after the invalid assignment, with no exception

#### Scenario: Change clears the buffer
- **WHEN** a context cleared to red sets `drawingBufferColorSpace` to `"display-p3"`
- **THEN** every pixel reads back as zero
