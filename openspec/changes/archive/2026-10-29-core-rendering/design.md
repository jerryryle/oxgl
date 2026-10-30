# Design

## Context

- ANGLE runs every context in WebGL-compatibility mode with robust access, robust resource initialization, client arrays off and bind-generates-resource off (`oxgl-sys` `create_context`). In that mode ANGLE performs the GLES validation WebGL needs, including WebGL's GLSL rules in its shader translator and out-of-range vertex fetch checks, which is what Chromium's passthrough decoder relies on. oxgl adds only what ANGLE cannot see: JS types, object ownership and deletion, typed-array sizes, and uniform-location bookkeeping.
- `oxgl-core` already has `Context::objects: SlotMap<ObjectKey, Object>` with an empty `Object` enum, and the runtime has a deferred-deletion queue for contexts. Contexts cross to JS as two `u32`s (`key_to_parts`).
- `drawing-buffer` binds an internal framebuffer as WebGL's default framebuffer.
- `oxgl-sys/src/calls.rs` generates `Current` methods for value-only GLES calls.

## Goals / Non-Goals

**Goals:** a complete, browser-equivalent buffer/shader/program/uniform/attribute/draw API for both versions; an object model that later object types (textures, framebuffers, VAOs, queries, samplers, sync, transform feedback) reuse unchanged; per-call overhead small enough that three.js's per-frame uniform and draw traffic is dominated by rendering.

**Non-Goals:** the object types listed in the proposal's Out of Scope; a WebIDL code generator.

## Decisions

### Objects are slotmap handles; JS wrappers carry the key

`Object` gains `Buffer { name, target }`, `Shader { name, kind }` and `Program { name }`. `target` is the WebGL "initial target" of a buffer (below). A JS object (`WebGLBuffer`, …) holds its context, the slot key as `[index, version]`, and a `deleted` flag. Native functions take an object as two `u32`s, with `[0, 0]` for `null`: slotmap versions of occupied slots are odd, so `0` never names an object.

`Context::delete_object(key)` removes the slot and calls `glDelete*`. A stale key resolves to nothing; the native call treats it as a deleted object. The GL name never reaches JS.

*Alternative:* passing GL names to JS. GL reuses names after deletion, so a stale JS object would silently address a new object, and the handle rule in `CLAUDE.md` forbids it.

### Validation split

The TS layer, per call:

1. converts arguments per WebIDL; an object argument of the wrong class (or not `null` where nullable) throws `TypeError`;
2. returns early on a lost context (`[WebGLHandlesContextLoss]` defaults);
3. checks ownership: an object from another context generates `INVALID_OPERATION` (WebGL 1.0 §5.14 "objects created by another context");
4. checks deletion where the WebGL spec names an error: `INVALID_OPERATION` for binding a deleted object, `INVALID_VALUE` for program and shader functions given a deleted object (Chromium's `ValidateWebGLProgramOrShader`), a silent no-op for `delete*` and `false` for `is*`.

Errors from steps 3–4 are synthesized through one native `synthesizeError`. Everything else goes to native code. `oxgl-core` checks what needs GL state or typed-array contents (buffer target compatibility, uniform array lengths, `getBufferSubData` sizes) and forwards the rest to ANGLE.

### The TS layer keeps bound objects reachable and answers object queries

A GL binding holds an object that JS may no longer reference. If its wrapper were collected, its finalizer would delete a bound object and change rendering. Like Blink, the context keeps strong references to everything bound or attached: buffers per target, the element array buffer and attribute buffers of the default vertex array, the current program, a program's attached shaders. `getParameter`'s object entries, `getVertexAttrib(VERTEX_ATTRIB_ARRAY_BUFFER_BINDING)` and `getAttachedShaders` read these references, so they return the same JS object, as browsers must.

`deleteBuffer` clears the context's references to that buffer exactly where GL unbinds it: the generic targets and the attribute and element bindings of the bound vertex array (OpenGL ES 2.0 §2.9, OpenGL ES 3.0 §2.9–§2.10; WebGL 1.0 §5.14.5). `deleteShader` and `deleteProgram` keep attachments and the current program, which GL also keeps until they are detached or replaced.

### Collected objects are deleted on the context's thread

Each object registers with a module-level `FinalizationRegistry` whose held value is `[contextIndex, contextVersion, objectIndex, objectVersion]` (no reference to the wrapper or the context). The callback calls `native.releaseObject`, which pushes `Deferred::Object` onto the runtime's queue. The queue is drained at the start of the next native call on that environment, on its thread, as context deletion already is. A queued object whose context is gone is skipped. `delete*` unregisters the object.

### Buffer target compatibility

WebGL forbids rebinding an element array buffer to a non-element target and vice versa (WebGL 1.0 §6.1 "Buffer Object Binding", WebGL 2.0 §5.1). `oxgl-core` records a buffer's first target as `Element` or `Other` (`COPY_READ_BUFFER`/`COPY_WRITE_BUFFER` count as `Other` on first bind and are allowed for either afterwards, matching Chromium), and `bindBuffer` generates `INVALID_OPERATION` on a mismatch before calling GL.

### Reading typed arrays

`oxgl-sys::napi_view` gains `ReadSource`, the read counterpart of `WriteTarget`. It exposes the view's bytes for one call through `with_bytes(|bytes: &[u8]| …)`:

- For a view on a non-shared `ArrayBuffer` (`napi_is_arraybuffer` on the view's buffer), the bytes are borrowed directly: no JS runs during the native call, no other thread can reach a non-shared buffer, and a detached buffer reports a null pointer, which becomes an empty slice.
- For a `SharedArrayBuffer`, another thread may write concurrently, so the bytes are first copied with relaxed atomic loads, as `WriteTarget` writes.

`bufferData` uploads tens of megabytes in some three.js scenes, so the copy is avoided on the common path. `Float32Array`/`Int32Array`/`Uint32Array` uniform data is read the same way; WebIDL `sequence<GLfloat>` arguments are converted to a typed array in TS first.

WebGL 2 `srcOffset`/`length` arguments are element counts. `oxgl-core` turns them into a byte range with the view's element size, checked for overflow, and generates `INVALID_VALUE` when the range exceeds the view (WebGL 2.0 §3.7.3).

### Uniform locations

`getUniformLocation` returns a `WebGLUniformLocation` holding its program, the program's link count at the time, the GL location and the uniform's type (from the program's active-uniform table, which TS caches per link). A uniform call with a location whose program is not current, or whose link count is stale, generates `INVALID_OPERATION` (WebGL 1.0 §5.14.10); a `null` location is a silent no-op. Array lengths are checked in `oxgl-core`: a length that is zero or not a multiple of the element count generates `INVALID_VALUE`. ANGLE checks the type against the call.

`getUniform` uses the stored type to choose the robust getter (`glGetUniform[f|i|ui]vRobustANGLE`) and the number of components, and TS builds the IDL return type (a number, boolean, sequence or typed array per WebGL 1.0 §5.14.10's table).

### Strings

Shader sources, info logs and active-variable names pass as UTF-8 `String`s. `getShaderSource` returns the source TS stored, so it round-trips exactly. Info logs and names come from robust getters bounded by their reported lengths.

### TS modules and the conformance runner

`src/context.ts` would pass 4,000 lines, so the classes move into modules: `webidl.ts` (conversions), `objects.ts` (object classes), `context.ts` (contexts). The conformance runner evaluates the JS layer in each page's realm from source. It now concatenates the modules in import order, stripping their `import` and `export` statements, as it already inlines the generated constants. Names stay unique across modules.

### Safety rules

- **Unsafe confinement:** new GLES calls are generated `Current` methods in `oxgl-sys` (`calls.rs` macros), each with a `// SAFETY:` comment. Calls taking pointers take slices (`&[u8]`, `&[f32]`, …) and pass their lengths, or robust variants with a `bufSize`. `ReadSource` is the only new FFI type; it never outlives the native call (lifetime tied to the call's scope, as `WriteTarget`).
- **No panics:** lengths and offsets are converted with `try_from` and checked arithmetic; failures generate WebGL errors.
- **Handle model:** above. GL names stay inside `oxgl-core`.
- **ArrayBuffer lifetime:** `ReadSource` borrows only for the call; `bufferData` and `bufferSubData` hand ANGLE the slice, and ANGLE copies before returning.

## Risks / Trade-offs

- [The TS layer's binding bookkeeping can diverge from GL's] → Only object-valued queries and GC reachability read it; every rendering decision is GL's. Tests compare both for each binding point this change adds.
- [Borrowing a non-shared buffer relies on no JS running during the native call] → Native functions never call back into JS (an existing rule of the binding, see `oxgl-node`'s module comment).
- [Inlining modules in the runner depends on unique top-level names] → The runner already throws when an unhandled `import`/`export` remains; a name clash fails loudly as a `SyntaxError` at evaluation.

## Migration Plan

The ABI version goes up; the package is unpublished.
