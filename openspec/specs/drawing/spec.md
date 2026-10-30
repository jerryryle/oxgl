# drawing Specification

## Purpose
Covers WebGL operations that write to the drawing buffer. This change introduces `clearColor` and `clear`; draw calls and other drawing-state operations extend this capability later.

## Requirements

### Requirement: clearColor
`clearColor(red, green, blue, alpha)` SHALL behave as specified in WebGL 1.0 §5.14.3 "Setting and getting state" (OpenGL ES 2.0 §4.2.3 for WebGL 1, OpenGL ES 3.0 §4.2.3 for WebGL 2). Arguments SHALL be converted per WebIDL `GLclampf`/`GLfloat` rules, and fewer than four arguments SHALL throw a `TypeError`.

#### Scenario: Clear color applied
- **WHEN** `clearColor(1, 0, 0, 1)` then `clear(COLOR_BUFFER_BIT)` are called
- **THEN** reading any pixel as RGBA/UNSIGNED_BYTE yields `[255, 0, 0, 255]`

#### Scenario: Out-of-range values are clamped for the default framebuffer
- **WHEN** `clearColor(2, -1, 0.5, 1)` then `clear(COLOR_BUFFER_BIT)` are called
- **THEN** pixels read back as red `255`, green `0`, blue `127` or `128`, alpha `255`

#### Scenario: WebIDL conversion
- **WHEN** `clearColor('1', null, undefined, true)` is called
- **THEN** it behaves as `clearColor(1, 0, NaN, 1)` per WebIDL numeric conversion, and no exception is thrown

#### Scenario: Too few arguments
- **WHEN** `clearColor(1, 0, 0)` is called
- **THEN** a `TypeError` is thrown and the clear color is unchanged

### Requirement: clear
`clear(mask)` SHALL behave as specified in WebGL 1.0 §5.14.11 "Draw Operations" and OpenGL ES 2.0 §4.2.3 (WebGL 2: OpenGL ES 3.0 §4.2.3), including generating `INVALID_VALUE` for bits other than `COLOR_BUFFER_BIT`, `DEPTH_BUFFER_BIT`, and `STENCIL_BUFFER_BIT`. Clearing a buffer the drawing buffer lacks SHALL have no effect on it and generate no error.

#### Scenario: Color clear
- **WHEN** `clear(COLOR_BUFFER_BIT)` is called after setting a clear color
- **THEN** every pixel of the drawing buffer has that color (cf. Khronos `conformance/rendering/gl-clear.html`)

#### Scenario: Invalid mask bits
- **WHEN** `clear(0x1)` is called
- **THEN** `getError()` returns `INVALID_VALUE` and the drawing buffer is unchanged

#### Scenario: Combined mask
- **WHEN** `clear(COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT | STENCIL_BUFFER_BIT)` is called on a buffer without stencil
- **THEN** the color is cleared and `getError()` returns `NO_ERROR`

### Requirement: flush and finish
`flush()` and `finish()` SHALL behave as WebGL 1.0 §5.14.11 specifies: `finish()` SHALL return only after every earlier command has completed, and neither SHALL generate an error. On a lost context both SHALL do nothing.

#### Scenario: Finish after clear
- **WHEN** `clear(COLOR_BUFFER_BIT)`, then `flush()` and `finish()` are called
- **THEN** both return `undefined`, `getError()` returns `NO_ERROR`, and a following `readPixels` sees the cleared color

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

### Requirement: Primitive restart on WebGL 2
WebGL 2 contexts SHALL restart primitives at the fixed maximum index of the index type, and `enable`, `disable` and `isEnabled` SHALL generate `INVALID_ENUM` for `PRIMITIVE_RESTART_FIXED_INDEX` (WebGL 2.0 §5.18).

#### Scenario: Restart index splits a strip
- **WHEN** a WebGL 2 `TRIANGLE_STRIP` element draw includes the index `0xFFFF` with `UNSIGNED_SHORT` indices
- **THEN** it renders as two strips (cf. deqp `primitiverestart`)

### Requirement: Attribute pointers without a buffer
`vertexAttribPointer` and `vertexAttribIPointer` SHALL generate `INVALID_OPERATION` when no buffer is bound to `ARRAY_BUFFER` and the offset is not 0 (WebGL 1.0 §6.4).

#### Scenario: Integer pointer without a buffer
- **WHEN** `vertexAttribIPointer(0, 1, INT, 0, 4)` is called with no `ARRAY_BUFFER`
- **THEN** it generates `INVALID_OPERATION` (cf. Khronos `conformance2/attribs/gl-vertexattribipointer.html`)

### Requirement: Instanced attribute range on WebGL 1
On WebGL 1, `drawArraysInstancedANGLE` and `drawElementsInstancedANGLE` SHALL generate `INVALID_OPERATION` and draw nothing when an enabled attribute with a nonzero divisor, read by the current program, would be fetched past the end of its buffer for the requested instance count (WebGL 1.0 §6.6), whatever the backend's robust buffer access.

#### Scenario: Instance count past the buffer
- **WHEN** an instanced attribute with divisor 1 has data for two instances and a draw asks for three
- **THEN** `INVALID_OPERATION` is generated (cf. Khronos `conformance/extensions/angle-instanced-arrays-out-of-bounds.html`)

#### Scenario: Attribute the program does not read
- **WHEN** the same attribute is enabled but the current program does not read its location
- **THEN** the draw generates no error
