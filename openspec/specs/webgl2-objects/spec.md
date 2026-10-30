# webgl2-objects Specification

## Purpose
Covers WebGL 2's vertex array objects, instanced drawing, indexed buffer bindings and uniform blocks, transform feedback, queries and sync objects (WebGL 2.0 §3.7.3, §3.7.9, §3.7.12–§3.7.17).

## Requirements

### Requirement: Vertex array objects
`createVertexArray`, `bindVertexArray`, `deleteVertexArray` and `isVertexArray` SHALL behave as WebGL 2.0 §3.7.17 specifies, with `WebGLVertexArrayObject` following the `webgl-objects` rules. Attribute state, attribute buffer bindings and the element array buffer binding SHALL belong to the bound vertex array.

#### Scenario: Separate state per vertex array
- **WHEN** attribute 0 is enabled with buffer A in vertex array V1, and V2 is then bound
- **THEN** in V2 `getVertexAttrib(0, VERTEX_ATTRIB_ARRAY_ENABLED)` is `false` and its buffer binding is `null`, and after rebinding V1 they are `true` and A (cf. Khronos `conformance2/vertex_arrays/vertex-array-object.html`)

#### Scenario: Deleting the bound vertex array
- **WHEN** the bound vertex array is deleted
- **THEN** `getParameter(VERTEX_ARRAY_BINDING)` is `null`

### Requirement: Instanced drawing
`drawArraysInstanced`, `drawElementsInstanced` and `vertexAttribDivisor` SHALL behave as WebGL 2.0 §3.7.9 specifies.

#### Scenario: Per-instance offsets
- **WHEN** two instances of a half-viewport quad are drawn with a per-instance offset attribute (divisor 1) moving the second instance to the other half
- **THEN** both halves are covered (cf. Khronos `conformance2/rendering/instanced-rendering-bug.html`)

### Requirement: Uniform blocks and indexed bindings
`bindBufferBase`, `bindBufferRange`, `getIndexedParameter`, `getUniformIndices`, `getActiveUniforms`, `getUniformBlockIndex`, `getActiveUniformBlockParameter`, `getActiveUniformBlockName` and `uniformBlockBinding` SHALL behave as WebGL 2.0 §3.7.3 and §3.7.16 specify. `getIndexedParameter` SHALL return the bound `WebGLBuffer` for `UNIFORM_BUFFER_BINDING` and `TRANSFORM_FEEDBACK_BUFFER_BINDING`.

#### Scenario: Uniform block drives a color
- **WHEN** a program reads its color from a uniform block bound to binding point 1, which holds a buffer with `[0, 1, 0, 1]`
- **THEN** it draws green (cf. Khronos `conformance2/buffers/uniform-buffers.html`)

#### Scenario: Block introspection
- **WHEN** a linked program has one uniform block `B` with one `vec4`
- **THEN** `getUniformBlockIndex(program, 'B')` is `0`, `getActiveUniformBlockName(program, 0)` is `'B'`, and `getActiveUniformBlockParameter(program, 0, UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES)` is a `Uint32Array` of length 1

### Requirement: Transform feedback
Transform feedback objects and calls SHALL behave as WebGL 2.0 §3.7.15 specifies, with `WebGLTransformFeedback` following the `webgl-objects` rules.

#### Scenario: Capture vertex outputs
- **WHEN** a program with `transformFeedbackVaryings(['v'], INTERLEAVED_ATTRIBS)` draws 3 points with rasterizer discard while transform feedback is active into a bound buffer
- **THEN** the buffer holds the 3 captured values (cf. Khronos `conformance2/transform_feedback/simultaneous_binding.html`)

### Requirement: Queries
Query objects and calls SHALL behave as WebGL 2.0 §3.7.12 specifies, and a query's result SHALL NOT become available before control returns to the event loop after `endQuery` (WebGL 2.0 §5.35).

#### Scenario: Result after a turn
- **WHEN** an `ANY_SAMPLES_PASSED` query surrounds a draw that covers pixels, and `QUERY_RESULT_AVAILABLE` is read at once and again after a `setTimeout`
- **THEN** it is `false` at once, then `true`, and `QUERY_RESULT` is `1`, a number (cf. Khronos `conformance2/query/occlusion-query.html`)

### Requirement: Sync objects
`fenceSync`, `isSync`, `deleteSync`, `clientWaitSync`, `waitSync` and `getSyncParameter` SHALL behave as WebGL 2.0 §3.7.14 specifies. `clientWaitSync` SHALL NOT block; a timeout above `MAX_CLIENT_WAIT_TIMEOUT_WEBGL` SHALL generate `INVALID_VALUE`, and the sync SHALL NOT signal before control returns to the event loop.

#### Scenario: Signaled after a turn
- **WHEN** `fenceSync` is called and `getSyncParameter(sync, SYNC_STATUS)` is read at once and after a `setTimeout`
- **THEN** it is `UNSIGNALED`, then `SIGNALED`, and `clientWaitSync(sync, 0, 0)` then returns `ALREADY_SIGNALED` or `CONDITION_SATISFIED` (cf. Khronos `conformance2/sync/sync-webgl-specific.html`)
