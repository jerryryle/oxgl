# Spec Delta

## REMOVED Requirements

### Requirement: Drawing buffer resize
**Reason**: Replaced by "Drawing buffer resizing", which keeps the buffer on a resize to the same size instead of clearing it.
**Migration**: None; code that relied on a same-size resize to clear calls `clear` instead.

## ADDED Requirements

### Requirement: Drawing buffer resizing
A context's non-standard `resize(width, height)` SHALL reallocate its drawing buffer at the new size, clamped as at creation, with a new buffer's contents, and keep all other state, including viewport and scissor box (WebGL 1.0 §2.2). A resize to the size last requested SHALL change nothing. On a `HeadlessCanvas` context it SHALL set the canvas's `width` and `height` to the requested size; on a lost context it SHALL do nothing.

#### Scenario: Viewport kept on resize
- **WHEN** a 10×20 context is resized to 20×10 and `getParameter(VIEWPORT)` is called
- **THEN** it returns `[0, 0, 10, 20]`, `drawingBufferWidth` is `20`, and every pixel reads back as zero (cf. Khronos `conformance/canvas/viewport-unchanged-upon-resize.html`)

#### Scenario: Resize to the same size keeps the contents
- **WHEN** a context cleared to red is resized to its current size
- **THEN** every pixel still reads back as red (cf. Khronos `conformance/canvas/render-after-resize-test.html`)

#### Scenario: State that affects clearing is kept
- **WHEN** a context sets a red clear color, `colorMask(true, false, false, false)` and an enabled scissor test, and is then resized
- **THEN** every pixel reads back as zero, and the clear color, color mask and scissor test still read back as set

#### Scenario: Invalid size
- **WHEN** `resize(-1, 4)`, `resize(1.5, 4)` or `resize(2147483648, 4)` is called
- **THEN** a `RangeError` is thrown and the drawing buffer is unchanged

#### Scenario: Canvas keeps the requested size
- **WHEN** `max` is `getParameter(MAX_VIEWPORT_DIMS)[0]` and a `HeadlessCanvas` context is resized with `resize(max + 100, 4)`
- **THEN** `gl.canvas.width` is `max + 100` and `gl.drawingBufferWidth` is at most `max`
