## MODIFIED Requirements

### Requirement: Draw calls
`drawArrays` and `drawElements` SHALL draw as WebGL 1.0 §5.14.11 specifies, and on WebGL 2 so SHALL `drawRangeElements`, including the WebGL checks for out-of-range vertex and index access (WebGL 1.0 §6.6, WebGL 2.0 §5.12): an access outside a bound buffer SHALL generate `INVALID_OPERATION` or read zeros or in-range values, never other memory. `drawElements` with an offset that is not a multiple of the index type's size SHALL generate `INVALID_OPERATION` (WebGL 1.0 §6.4). `drawRangeElements` SHALL discard `start` and `end` and draw as `drawElements`, after generating `INVALID_VALUE` when `end` is less than `start` (WebGL 2.0, "Writing to the drawing buffer"; OpenGL ES 3.0.6 §2.9.3).

#### Scenario: Triangle
- **WHEN** a program drawing a constant red is used with a full-viewport triangle pair from an `ARRAY_BUFFER` and `drawArrays(TRIANGLES, 0, 6)` is called
- **THEN** every pixel of the drawing buffer reads `[255, 0, 0, 255]` (cf. Khronos `conformance/rendering/simple.html`)

#### Scenario: Indexed draw
- **WHEN** the same quad is drawn with `drawElements(TRIANGLES, 6, UNSIGNED_SHORT, 0)` from an index buffer
- **THEN** the result is identical

#### Scenario: Out-of-range draw
- **WHEN** `drawArrays(TRIANGLES, 0, 3000)` is called with a 6-vertex buffer enabled
- **THEN** `INVALID_OPERATION` is generated or nothing outside the buffer is read, and the process is unaffected (cf. Khronos `conformance/rendering/draw-arrays-out-of-bounds.html`)

#### Scenario: Misaligned index offset
- **WHEN** `drawElements(TRIANGLES, 3, UNSIGNED_SHORT, 1)` is called
- **THEN** `INVALID_OPERATION` is generated (cf. Khronos `conformance/rendering/draw-elements-out-of-bounds.html`)

#### Scenario: Indices outside the range
- **WHEN** `drawRangeElements(POINTS, 5, 5, 5, UNSIGNED_SHORT, 0)` is called on a WebGL 2 context with indices `[4, 0, 2, 6, 7]` into a 10-vertex buffer
- **THEN** no error is generated, the points draw as `drawElements` draws them, and the process is unaffected (cf. Khronos `deqp/functional/gles3/draw/draw_range_elements.html`)

#### Scenario: End before start
- **WHEN** `drawRangeElements(TRIANGLES, 5, 0, 6, UNSIGNED_SHORT, 0)` is called
- **THEN** `INVALID_VALUE` is generated and nothing is drawn
