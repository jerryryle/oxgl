# Design

## Context

- Contexts are created in ANGLE's WebGL-compatibility mode, where GL extensions start disabled and `glRequestExtensionANGLE` enables them; `GL_REQUESTABLE_EXTENSIONS_ANGLE` lists those that can be enabled. ANGLE then gates entry points, enums, formats and shader features on what is enabled, which is how Chromium implements WebGL extensions.
- WebGL 1 contexts already have three GL extensions enabled internally for the drawing buffer (`drawing-buffer`), and `framebuffers` holds WebGL 1 to WebGL's own format and attachment lists so they do not leak.
- `getParameter` gates parameters by its table (`context-state`); extension parameters are not in it yet.

## Decisions

### One table drives everything

`oxgl-core` has one table of WebGL extensions. Each row names the WebGL extension, the versions it exists on, the GL extensions it needs (all must be requestable or already enabled), and what enabling it adds to oxgl's own WebGL 1 lists and `getParameter` table. `getSupportedExtensions` filters the table by version and ANGLE's lists, read once per context. `getExtension` matches names case-insensitively (WebGL 1.0 §5.14.14), requests the GL extensions, records the WebGL extension as enabled, and returns its object; the TS layer caches the object, so repeated calls return the same one. Asking for an extension again after the context is lost returns `null`.

Enabled extensions extend, in `oxgl-core`:
- WebGL 1 renderbuffer formats: `SRGB8_ALPHA8_EXT` (`EXT_sRGB`), `RGBA16F_EXT`/`RGB16F_EXT` (`EXT_color_buffer_half_float`), `RGBA32F_EXT` (`WEBGL_color_buffer_float`);
- WebGL 1 attachments: `COLOR_ATTACHMENTi_WEBGL` up to `MAX_COLOR_ATTACHMENTS_WEBGL` (`WEBGL_draw_buffers`);
- `getParameter` rows: for example `MAX_TEXTURE_MAX_ANISOTROPY_EXT`, `FRAGMENT_SHADER_DERIVATIVE_HINT_OES`, `MAX_DRAW_BUFFERS_WEBGL`/`DRAW_BUFFERi_WEBGL`, `MAX_COLOR_ATTACHMENTS_WEBGL`, `VERTEX_ARRAY_BINDING_OES` (an object, answered in TS), `UNMASKED_VENDOR_WEBGL`/`UNMASKED_RENDERER_WEBGL` (strings from `GL_VENDOR`/`GL_RENDERER`), `MAX_CLIP_DISTANCES_WEBGL`, `CLIP_ORIGIN_EXT`, `POLYGON_OFFSET_CLAMP_EXT`, `PROVOKING_VERTEX_WEBGL`, `POLYGON_MODE_WEBGL`, `MAX_DUAL_SOURCE_DRAW_BUFFERS_WEBGL`;
- `COMPRESSED_TEXTURE_FORMATS`: the formats of enabled compressed-texture extensions, read from GL.

### WebGL 1 forms of WebGL 2 features call the extension entry points

ANGLE checks the client version of each entry point, so on ES2 contexts `OES_vertex_array_object` calls `glBindVertexArrayOES`, `ANGLE_instanced_arrays` calls `glDrawArraysInstancedANGLE`, `WEBGL_draw_buffers` calls `glDrawBuffersEXT`. The core methods already used by WebGL 2 (`bind_vertex_array`, `draw_*_instanced`, `vertex_attrib_divisor`, `draw_buffers`) pick the entry point by version, and the TS extension objects call the same native exports. The `OES_vertex_array_object` objects are `WebGLVertexArrayObjectOES` instances sharing the vertex-array mirror of `webgl2-objects`; `VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE` is answered by `getVertexAttrib` once `ANGLE_instanced_arrays` is enabled.

### Extension objects

Each extension object is an instance of a class named after the extension's IDL interface, not constructible, with its constants defined like interface constants (read-only, enumerable, on the prototype and the interface object) and its operations enumerable. Its methods convert arguments per WebIDL and do nothing on a lost context.

### Safety rules

- **Unsafe confinement:** new GL entry points are `Current` methods in `oxgl-sys`; `glMultiDraw*ANGLE` take Rust slices of equal length checked before the call; `glGetTranslatedShaderSourceANGLE` writes into a buffer sized from `TRANSLATED_SHADER_SOURCE_LENGTH_ANGLE`.
- **No panics:** unknown names return `null`; table lookups are total.
- **Handle model / ArrayBuffer lifetime:** unchanged; `WEBGL_multi_draw` reads its arrays through `ReadSource` for the call only.

## Risks / Trade-offs

- [An extension whose GL extensions are requestable may still lack a feature on SwiftShader] → `getSupportedExtensions` reflects ANGLE's own list, which ANGLE derives from the backend's capabilities, as Chromium does.
