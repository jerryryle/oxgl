## ADDED Requirements

### Requirement: Drawing buffer as a PNG
The package SHALL export `encodePNG(gl)`, returning a `Promise` of a Node `Buffer` holding a PNG of `gl`'s drawing buffer at its current size: 8-bit RGBA, top row first, unpremultiplied as a canvas's pixels are read (WebGL 1.0 §5.14.8), as `toDataURL('image/png')` serializes a canvas (HTML §4.12.5, "Serializing bitmaps to a file"). It SHALL read the drawing buffer whatever framebuffer is bound, resolving an antialiased one.

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

### Requirement: PNG result typed without Node types
The package's TypeScript declarations SHALL type `encodePNG`'s result as `Promise<Uint8Array>`, so that a project with the DOM library's globals and no Node type definitions can use them.

#### Scenario: Declarations without Node types
- **WHEN** a TypeScript project with `lib: ["ES2023", "DOM"]`, `types: []` and no `@types/node` type-checks `const png: Uint8Array = await encodePNG(gl)` against the package's declarations
- **THEN** it compiles without errors

### Requirement: Pixels read at the call
`encodePNG` SHALL read the drawing buffer before it returns, so drawing to, resizing, losing or destroying the context before the promise settles SHALL NOT change the result.

#### Scenario: Drawing after the call
- **WHEN** a context is cleared to red, `encodePNG(gl)` is called, the context is cleared to green and destroyed, and the promise is then awaited and decoded
- **THEN** the image is red

#### Scenario: Resizing after the call
- **WHEN** a 4×4 context is cleared to red, `encodePNG(gl)` is called, the context is resized to 8×2 and cleared to green, and the promise is then awaited and decoded
- **THEN** the image is 4×4 and red

### Requirement: Encoding leaves the context unchanged
`encodePNG` SHALL leave every piece of the context's state unchanged, including bindings, pixel pack parameters and a bound pixel pack buffer, and SHALL neither add nor remove errors reported by `getError`.

#### Scenario: State and errors kept
- **WHEN** a WebGL 2 context binds a framebuffer object and a pixel pack buffer, sets `PACK_ALIGNMENT` to 8 and `PACK_ROW_LENGTH` to 3, generates `INVALID_ENUM`, and calls `encodePNG(gl)`
- **THEN** the bindings and pack parameters read back as set, and `getError()` returns `INVALID_ENUM` and then `NO_ERROR`

### Requirement: Encoding errors
`encodePNG` SHALL return a promise rejected with a `TypeError` when its argument is not a context oxgl created, and with an `Error` with `code === 'OXGL_CONTEXT_LOST'` when the context is lost or destroyed; it SHALL NOT throw synchronously. A context restored after a loss SHALL encode again.

#### Scenario: Not a context
- **WHEN** `encodePNG({})` is called
- **THEN** it returns a promise that rejects with a `TypeError`

#### Scenario: Destroyed context
- **WHEN** a context is destroyed and `encodePNG(gl)` is called
- **THEN** it returns a promise that rejects with an `Error` with `code === 'OXGL_CONTEXT_LOST'`

#### Scenario: Lost and restored
- **WHEN** a context's canvas calls `preventDefault()` on `webglcontextlost`, the context is lost through `WEBGL_lose_context`, `encodePNG(gl)` is called, `restoreContext()` is called, and after `webglcontextrestored` fires the context is cleared to red
- **THEN** the first promise rejects with `OXGL_CONTEXT_LOST`, and `encodePNG(gl)` after the restore decodes as red
