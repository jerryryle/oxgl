# Proposal

## Why

`getSupportedExtensions()` returns an empty list and `getExtension()` always `null`, so WebGL 1 content cannot use instancing, vertex array objects, multiple render targets, float or half-float textures, depth textures, derivatives or anisotropic filtering, and WebGL 2 content cannot render to float textures (`EXT_color_buffer_float`, which three.js needs for HDR render targets) or use compressed textures. Conformance pages under `conformance/extensions` and `conformance2/extensions` all stop there.

## What Changes

- **The extension mechanism** (WebGL 1.0 §5.14.14): `getSupportedExtensions` lists every WebGL extension whose underlying GL extensions ANGLE can enable on this context; `getExtension(name)` (case-insensitive) enables them through `glRequestExtensionANGLE` and returns the same extension object on every call for that context, or `null` for an unknown or unsupported name. Extension objects follow the extension's IDL: constants on the object, methods that act on their context and do nothing once it is lost.
- **WebGL 1 extensions with entry points**: `ANGLE_instanced_arrays`, `OES_vertex_array_object` (with `WebGLVertexArrayObjectOES`), `WEBGL_draw_buffers`.
- **WebGL 2 extensions with entry points**: `OES_draw_buffers_indexed`, `WEBGL_provoking_vertex`.
- **Extensions on both versions with entry points**: `WEBGL_lose_context` (the `context-loss` change wires restoring), `WEBGL_debug_shaders`, `WEBGL_multi_draw`, `KHR_parallel_shader_compile`, `EXT_clip_control`, `EXT_polygon_offset_clamp`, `WEBGL_polygon_mode`.
- **Extensions that add only constants, formats or shader features**, each exposed when ANGLE supports it on the context: `EXT_blend_minmax`, `EXT_color_buffer_half_float`, `EXT_color_buffer_float`, `EXT_float_blend`, `EXT_frag_depth`, `EXT_shader_texture_lod`, `EXT_sRGB`, `EXT_texture_filter_anisotropic`, `EXT_texture_norm16`, `EXT_depth_clamp`, `EXT_texture_mirror_clamp_to_edge`, `EXT_conservative_depth`, `OES_element_index_uint`, `OES_fbo_render_mipmap`, `OES_standard_derivatives`, `OES_texture_float`, `OES_texture_float_linear`, `OES_texture_half_float`, `OES_texture_half_float_linear`, `WEBGL_depth_texture`, `WEBGL_debug_renderer_info`, `WEBGL_clip_cull_distance`, `WEBGL_render_shared_exponent`, `WEBGL_stencil_texturing`, `WEBGL_blend_func_extended`, `NV_shader_noperspective_interpolation`, and the compressed-texture extensions (`WEBGL_compressed_texture_s3tc`, `_s3tc_srgb`, `_etc`, `_etc1`, `_astc`, `EXT_texture_compression_bptc`, `_rgtc`).
- **WebGL 1's lists grow with its extensions**: renderbuffer formats (`EXT_sRGB`, `EXT_color_buffer_half_float`), color attachments (`WEBGL_draw_buffers`), and `getParameter` parameters each extension adds, which answer `INVALID_ENUM` until it is enabled. `COMPRESSED_TEXTURE_FORMATS` lists the formats of enabled compressed-texture extensions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `extensions`: real support replaces the placeholders.
- `context-state`: extension parameters in `getParameter`.

## Impact

- `crates/oxgl-sys`: the extension entry points (`*ANGLE`, `*OES`, `*EXT` forms ANGLE exposes on ES2) and the requestable-extension query.
- `crates/oxgl-core`: the extension table (WebGL name → GL extensions, version, parameters), enabled-extension state per context, the WebGL 1 list growth.
- `src/`: extension objects and their classes.

## Out of Scope and Extension Points

- **`WEBGL_color_buffer_float`**: ANGLE's ES 2.0 contexts on SwiftShader cannot render to `RGBA`/`FLOAT` textures even with `GL_CHROMIUM_color_buffer_float_rgba`, so oxgl does not offer it; WebGL 2's `EXT_color_buffer_float` covers float rendering.
- **`KHR_parallel_shader_compile`** is offered only where ANGLE offers `GL_KHR_parallel_shader_compile` (not on SwiftShader): oxgl compiles within the call, and the extension's conformance page requires compiles that finish frames later.
- **`EXT_disjoint_timer_query` and `EXT_disjoint_timer_query_webgl2`**: timing information is a side channel that browsers gate or quantize; oxgl does not expose them now.
- **`OVR_multiview2`, `WEBGL_video_texture`, `WEBGL_shader_pixel_local_storage`, `WEBGL_compressed_texture_pvrtc`**: not exposed in this change.
- **Restoring lost contexts** (`context-loss` change): `WEBGL_lose_context.restoreContext` generates `INVALID_OPERATION` until then.
