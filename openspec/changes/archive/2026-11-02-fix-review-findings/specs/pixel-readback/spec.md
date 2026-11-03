## MODIFIED Requirements

### Requirement: Drawing buffer as a PNG
The package SHALL export `encodePNG(gl)`, returning a `Promise` of a Node `Buffer` holding a PNG of `gl`'s drawing buffer at its current size: 8-bit RGBA, top row first, unpremultiplied as a canvas's pixels are read (WebGL 1.0 §5.14.8), as `toDataURL('image/png')` serializes a canvas (HTML §4.12.5, "Serializing bitmaps to a file"). It SHALL read the drawing buffer's color whatever framebuffer is bound and whatever read buffer the page selected, resolving an antialiased one.

#### Scenario: Rows top first
- **WHEN** a 1×2 context has its top row cleared red and its bottom row green (with a scissor test) and the awaited `encodePNG(gl)` is decoded
- **THEN** the image is 1×2, its first row is red and its second green, all opaque

#### Scenario: Premultiplied buffer unpremultiplied
- **WHEN** a context with default attributes is cleared to `(0.5, 0, 0, 0.5)` and the awaited `encodePNG(gl)` is decoded
- **THEN** its pixel is `[255, 0, 0, 128]` within one unit

#### Scenario: No alpha channel
- **WHEN** a context created with `alpha: false` is cleared to `(0, 0, 1, 0)` and the awaited `encodePNG(gl)` is decoded
- **THEN** its pixel is `[0, 0, 255, 255]`

#### Scenario: Antialiased buffer
- **WHEN** a context created with `antialias: true` is cleared to blue and the awaited `encodePNG(gl)` is decoded
- **THEN** every pixel is blue

#### Scenario: Framebuffer object bound
- **WHEN** a context is cleared to red, then binds a framebuffer object cleared to green, and calls `encodePNG(gl)`
- **THEN** the decoded image is red

#### Scenario: After a resize
- **WHEN** a 4×4 context is resized to 8×2 and the awaited `encodePNG(gl)` is decoded
- **THEN** the image is 8×2

#### Scenario: Read buffer NONE
- **WHEN** a WebGL 2 context, created with `antialias: false` and again with `antialias: true`, is cleared to red, calls `readBuffer(NONE)` with the drawing buffer bound, and the awaited `encodePNG(gl)` is decoded
- **THEN** every pixel is red, `getParameter(READ_BUFFER)` is still `NONE`, `readPixels` from the drawing buffer still generates `INVALID_OPERATION` (cf. Khronos `conformance2/renderbuffers/readbuffer.html`), and after `readBuffer(BACK)` `readPixels` returns red with `NO_ERROR`
