# Spec Delta

## ADDED Requirements

### Requirement: Vertex attributes
The vertex attribute methods of WebGL 1.0 §5.14.10 (`enableVertexAttribArray`, `vertexAttribPointer`, `vertexAttrib*`, `getVertexAttrib`, `getVertexAttribOffset` and the rest) SHALL behave as specified there, and on WebGL 2 so SHALL the integer forms of WebGL 2.0 §3.7.8. `vertexAttribPointer` with no `ARRAY_BUFFER` bound and a non-zero offset SHALL generate `INVALID_OPERATION` (WebGL 1.0 §6.3).

#### Scenario: Pointer state
- **WHEN** a buffer is bound and `vertexAttribPointer(1, 3, FLOAT, false, 12, 4)` is called
- **THEN** `getVertexAttrib(1, VERTEX_ATTRIB_ARRAY_SIZE)` is `3`, `VERTEX_ATTRIB_ARRAY_BUFFER_BINDING` is the buffer, and `getVertexAttribOffset(1, VERTEX_ATTRIB_ARRAY_POINTER)` is `4` (cf. Khronos `conformance/attribs/gl-vertexattribpointer.html`)

#### Scenario: Constant attribute
- **WHEN** `vertexAttrib2f(0, 1, 2)` is called
- **THEN** `getVertexAttrib(0, CURRENT_VERTEX_ATTRIB)` is a `Float32Array` `[1, 2, 0, 1]` (cf. Khronos `conformance/attribs/gl-vertex-attrib.html`)

#### Scenario: Integer attribute (WebGL 2)
- **WHEN** a WebGL 2 context calls `vertexAttribI4ui(0, 1, 2, 3, 4)`
- **THEN** `getVertexAttrib(0, CURRENT_VERTEX_ATTRIB)` is a `Uint32Array` `[1, 2, 3, 4]`

#### Scenario: Index out of range
- **WHEN** `enableVertexAttribArray(MAX_VERTEX_ATTRIBS)` is called
- **THEN** `INVALID_VALUE` is generated

### Requirement: Draw calls
`drawArrays` and `drawElements` SHALL draw as WebGL 1.0 §5.14.11 specifies, and on WebGL 2 so SHALL `drawRangeElements`, including the WebGL checks for out-of-range vertex and index access (WebGL 1.0 §6.6, WebGL 2.0 §5.12): an access outside a bound buffer SHALL generate `INVALID_OPERATION` or read zeros or in-range values, never other memory. `drawElements` with an offset that is not a multiple of the index type's size SHALL generate `INVALID_OPERATION` (WebGL 1.0 §6.4).

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
