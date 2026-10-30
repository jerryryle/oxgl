# Design

## Context

- `core-rendering` mirrors the default vertex array (element buffer, attribute buffers) and generic buffer bindings in TS; `framebuffers` and `textures` added the other bindings. ANGLE in WebGL-compatibility mode validates the WebGL 2 rules for these objects (for example a buffer bound for transform feedback and another use at once).
- `getParameter` already reports `MAX_CLIENT_WAIT_TIMEOUT_WEBGL` as 0 (`context-state`).

## Decisions

### Vertex arrays own their mirrored state

The TS context state's `vao` field, today the default vertex array's state, becomes the bound vertex array's state: each `WebGLVertexArrayObject` carries its own element buffer and attribute buffers, and binding `null` restores the default's. Deleting the bound vertex array binds the default, as GL does. `deleteBuffer` already clears only the bound vertex array's references, which is GL's rule (OpenGL ES 3.0 §2.10).

### Indexed bindings

`bindBufferBase`/`bindBufferRange` also set the generic binding (OpenGL ES 3.0 §2.10.1.1). Uniform-buffer indexed bindings are context state; transform-feedback ones belong to the bound transform feedback object, so each `WebGLTransformFeedback` (and the default one) carries its buffer array in the mirror. `getIndexedParameter` answers the `*_BINDING` pnames from the mirror and `*_START`/`*_SIZE` from GL (`glGetInteger64i_vRobustANGLE`).

### Query and sync results wait for the event loop

WebGL 2.0 §5.35 forbids query results and sync status from becoming available before control returns to the event loop, so code cannot spin on them. Each query's `endQuery` and each `fenceSync` records the current "turn" number and schedules one `setTimeout(…, 0)` (unreferenced, so it never keeps Node alive) that advances it. Until the turn has advanced, `QUERY_RESULT_AVAILABLE` is `false`, `SYNC_STATUS` is `UNSIGNALED` and `clientWaitSync` returns `TIMEOUT_EXPIRED`; afterwards they come from GL. `setTimeout` exists both in Node and in the conformance runner's page realm.

`clientWaitSync` never blocks: its timeout above `MAX_CLIENT_WAIT_TIMEOUT_WEBGL` (0) generates `INVALID_VALUE` (WebGL 2.0 §3.7.14), and it calls GL with timeout 0.

### Sync handles

A `GLsync` is a pointer-typed GL handle. `oxgl-sys` wraps it in `SyncHandle`, a `Copy` newtype whose field is private, so `oxgl-core` stores it in the slotmap (`Object::Sync`) but can only pass it back to `Current` methods. Handles are removed from the slotmap before `glDeleteSync`, so a deleted handle never reaches GL; ANGLE also validates every handle it receives.

### Safety rules

- **Unsafe confinement:** all new GL calls are `Current` methods; array arguments (`glGetUniformIndices`, `glTransformFeedbackVaryings`, `glGetActiveUniformsiv`) take Rust slices and `CString`s that outlive the call; queries use robust variants or buffers sized from the matching length query.
- **No panics:** names with interior NUL bytes generate `INVALID_VALUE`; lengths are converted with `try_from`.
- **Handle model:** every new object, the sync included, is a slotmap handle; GL names and sync pointers never reach JS.
- **ArrayBuffer lifetime:** no new view access.
