# Proposal

## Why

three.js's WebGL 2 renderer creates a vertex array object per geometry, draws instanced meshes, and uses uniform buffers for some materials; WebGL 2 pages also test queries, sync objects and transform feedback. These are the last WebGL 2 objects and entry points oxgl lacks (the conformance groups `transformFeedbackVaryings` 43, uniform blocks ~25, `createVertexArray` 10, instancing 6, queries 4).

## What Changes

- **Vertex array objects** (WebGL 2.0 §3.7.17): `WebGLVertexArrayObject`, `createVertexArray`, `bindVertexArray`, `deleteVertexArray`, `isVertexArray`, `VERTEX_ARRAY_BINDING`. Each vertex array keeps its own element buffer and attribute buffer bindings in the TS mirror.
- **Instancing** (WebGL 2.0 §3.7.9): `drawArraysInstanced`, `drawElementsInstanced`, `vertexAttribDivisor`.
- **Indexed buffer bindings and uniform blocks** (WebGL 2.0 §3.7.3, §3.7.16): `bindBufferBase`, `bindBufferRange`, `getIndexedParameter`, `getUniformIndices`, `getActiveUniforms`, `getUniformBlockIndex`, `getActiveUniformBlockParameter`, `getActiveUniformBlockName`, `uniformBlockBinding`.
- **Transform feedback** (WebGL 2.0 §3.7.15): `WebGLTransformFeedback`, create/delete/is/bind, `beginTransformFeedback`, `endTransformFeedback`, `pauseTransformFeedback`, `resumeTransformFeedback`, `transformFeedbackVaryings`, `getTransformFeedbackVarying`.
- **Queries** (WebGL 2.0 §3.7.12): `WebGLQuery`, create/delete/is, `beginQuery`, `endQuery`, `getQuery`, `getQueryParameter`. Results become available only after control returns to the event loop, as WebGL requires (WebGL 2.0 §5.35 "Query results").
- **Sync objects** (WebGL 2.0 §3.7.14): `WebGLSync`, `fenceSync`, `isSync`, `deleteSync`, `clientWaitSync` (no waiting: timeout must be 0 up to `MAX_CLIENT_WAIT_TIMEOUT_WEBGL`, which is 0), `waitSync`, `getSyncParameter`; status, like queries, changes only between tasks.
- `getParameter` returns the bound vertex array, transform feedback, and the generic `TRANSFORM_FEEDBACK_BUFFER`/`UNIFORM_BUFFER` bindings set by `bindBufferBase/Range`.

## Capabilities

### New Capabilities

- `webgl2-objects`: vertex arrays, instancing, indexed buffer bindings and uniform blocks, transform feedback, queries and sync objects (WebGL 2.0 §3.7.3, §3.7.9, §3.7.12–§3.7.17).

### Modified Capabilities

- `context-state`: the bindings of these objects in `getParameter`.

## Impact

- `crates/oxgl-sys`: VAO, instancing, indexed-binding, uniform-block, transform-feedback, query and sync entry points. A sync is a GL pointer handle: it is held in an `oxgl-sys` type that only `Current` methods can use, inside the `oxgl-core` slotmap.
- `crates/oxgl-core`, `crates/oxgl-node`, `src/`: objects, exports and bookkeeping.

## Out of Scope and Extension Points

- **The WebGL 1 extension forms** (`OES_vertex_array_object`, `ANGLE_instanced_arrays`, `EXT_disjoint_timer_query`): the `extensions` change exposes them on top of these implementations.
- **Waiting in `clientWaitSync`**: `MAX_CLIENT_WAIT_TIMEOUT_WEBGL` is 0, as WebGL allows, so no call blocks the event loop.
