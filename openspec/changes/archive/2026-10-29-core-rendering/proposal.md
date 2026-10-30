# Proposal

## Why

After `context-state` and `drawing-buffer`, every remaining conformance group stops at an object call oxgl lacks: `createShader` (672 pages), `createProgram` (582), `createBuffer` (111). Nothing can be drawn yet, so neither three.js nor the texture, framebuffer and WebGL 2 pages can run. This change adds the pipeline from vertex data to pixels: buffers, shaders and programs, uniforms, vertex attributes and draw calls, together with the object model every later object type reuses.

## What Changes

- **WebGL objects.** `WebGLObject` and its subclasses `WebGLBuffer`, `WebGLShader` and `WebGLProgram`, plus `WebGLUniformLocation` and `WebGLActiveInfo` (WebGL 1.0 §5.3–§5.12). Objects are generational slotmap handles in `oxgl-core`. The context validates ownership and deletion, and a collected object is deleted on its context's thread.
- **Buffers** (WebGL 1.0 §5.14.5, WebGL 2.0 §3.7.3): `createBuffer`, `bindBuffer`, `bufferData` (size and data overloads, WebGL 2 `srcOffset`/`length`), `bufferSubData`, `deleteBuffer`, `isBuffer`, `getBufferParameter`; WebGL 2's `copyBufferSubData` and `getBufferSubData`; the WebGL buffer-target rules (WebGL 1.0 §6.1, WebGL 2.0 §5.1).
- **Shaders and programs** (WebGL 1.0 §5.14.9): create, delete, attach, detach, `shaderSource`, `compileShader`, `linkProgram`, `useProgram`, `validateProgram`, the parameter and info-log queries, `getShaderSource`, `getAttachedShaders`, `bindAttribLocation`, `getAttribLocation`, `getActiveAttrib`, `getActiveUniform`, `isShader`, `isProgram`; WebGL 2's `getFragDataLocation`.
- **Uniforms** (WebGL 1.0 §5.14.10, WebGL 2.0 §3.7.8): `getUniformLocation`, every `uniform*` and `uniformMatrix*` setter including WebGL 2's unsigned, non-square-matrix and `srcOffset`/`srcLength` forms, and `getUniform`.
- **Vertex attributes** (WebGL 1.0 §5.14.10): `enableVertexAttribArray`, `disableVertexAttribArray`, `vertexAttribPointer`, `vertexAttrib[1234]f[v]`, `getVertexAttrib`, `getVertexAttribOffset`; WebGL 2's `vertexAttribIPointer`, `vertexAttribI4[u]i[v]`.
- **Draw calls** (WebGL 1.0 §5.14.11): `drawArrays`, `drawElements`; WebGL 2's `drawRangeElements`.
- `getParameter` returns the bound buffer and program objects instead of `null`.
- Conformance expectations are regenerated.

## Capabilities

### New Capabilities

- `webgl-objects`: the object model shared by every WebGL object type: handles, ownership, deletion, `is*` queries, lost contexts and garbage collection.
- `buffers`: buffer objects and their data (WebGL 1.0 §5.14.5, WebGL 2.0 §3.7.3).
- `shaders-programs`: shaders, programs, attribute and uniform introspection, and uniform values (WebGL 1.0 §5.14.9–§5.14.10).

### Modified Capabilities

- `drawing`: vertex attributes and the draw calls.
- `context-state`: `getParameter` reports `ARRAY_BUFFER_BINDING`, `ELEMENT_ARRAY_BUFFER_BINDING`, `CURRENT_PROGRAM` and, on WebGL 2, `COPY_READ_BUFFER_BINDING`, `COPY_WRITE_BUFFER_BINDING`, `PIXEL_PACK_BUFFER_BINDING`, `PIXEL_UNPACK_BUFFER_BINDING`, `TRANSFORM_FEEDBACK_BUFFER_BINDING` and `UNIFORM_BUFFER_BINDING`.

## Impact

- `crates/oxgl-sys`: about 90 GLES entry points through the `calls.rs` macros, plus a typed-array *read* view beside `WriteTarget`.
- `crates/oxgl-core`: the `Object` slotmap gains buffer, shader and program variants, and the runtime's deletion queue gains objects.
- `crates/oxgl-node`: the new exports; `native_abi_version` goes up.
- `src/`: the object classes and the new methods, split into modules that the conformance runner inlines.
- `conformance/page.mjs`, `conformance/expectations.txt`; tests under `test/`.

## Out of Scope and Extension Points

- **Textures, samplers and framebuffers** (`textures` and `framebuffers` changes). `getParameter`'s texture, framebuffer and renderbuffer bindings stay `null`. Programs that sample textures link and draw with the default (incomplete) texture, which reads as black, as in a browser.
- **Vertex array objects, instancing, transform feedback, queries, sync objects and uniform buffers** (WebGL 2 objects change). The WebGL 2 buffer targets for them (`TRANSFORM_FEEDBACK_BUFFER`, `UNIFORM_BUFFER`) are bindable here, as the IDL allows; `bindBufferBase`/`bindBufferRange` and the indexed bindings come with that change.
- **Extensions** that add entry points (`ANGLE_instanced_arrays`, `OES_vertex_array_object`, …) and `OES_element_index_uint` on WebGL 1 (`extensions` change). Until then `drawElements` with `UNSIGNED_INT` on WebGL 1 generates `INVALID_ENUM`, from ANGLE.
- **`WebGLObject.label`** is a plain stored string; no debug output uses it.
- **Lost-context events and `restoreContext`** (`context-loss`). Objects of a lost context stay invalid forever, which is also what a restore requires.
