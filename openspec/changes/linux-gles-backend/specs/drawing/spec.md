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

### Requirement: Instanced attribute range on WebGL 1
On WebGL 1, `drawArraysInstancedANGLE`, `drawElementsInstancedANGLE` and the instanced forms of `WEBGL_multi_draw` SHALL generate `INVALID_OPERATION` and draw nothing when an enabled attribute with a nonzero divisor, read by the current program, would be fetched past the end of its buffer for the requested instance count (WebGL 1.0 §6.6), whatever the backend's robust buffer access. A multi-draw is checked against its largest instance count.

#### Scenario: Instance count past the buffer
- **WHEN** an instanced attribute with divisor 1 has data for two instances and a draw asks for three
- **THEN** `INVALID_OPERATION` is generated (cf. Khronos `conformance/extensions/angle-instanced-arrays-out-of-bounds.html`)

#### Scenario: Multi-draw past the buffer
- **WHEN** the same attribute is used by `multiDrawArraysInstancedWEBGL` with instance counts `[2, 3]`
- **THEN** `INVALID_OPERATION` is generated and neither draw runs

#### Scenario: Attribute the program does not read
- **WHEN** the same attribute is enabled but the current program does not read its location
- **THEN** the draw generates no error
