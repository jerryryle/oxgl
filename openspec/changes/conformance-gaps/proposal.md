# Proposal

## Why

After the extension and context-loss changes, the Khronos suites still failed on behavior WebGL defines and Chromium implements, where oxgl followed GL instead or skipped a check: deleted shaders and programs that GL keeps alive, location queries on unlinked programs, texture calls with no texture bound, integer and sRGB `TexImageSource` uploads, empty attachment queries on WebGL 1, color attachments past the maximum, and WebGL 2's always-on primitive restart.

## What Changes

- **Shader and program lifetime** (OpenGL ES 2.0 §2.10.1, §2.10.3): a deleted shader stays a shader while attached, and a deleted program while current; `isShader`/`isProgram` and the other calls accept them until GL frees them.
- **Locations need a linked program**: `getAttribLocation`, `getUniformLocation` and `getFragDataLocation` generate `INVALID_OPERATION` for a program whose last link failed or that was never linked, before any name check.
- **Textures**: texture calls with no texture bound to a valid target generate `INVALID_OPERATION`; `texParameter*` accepts only WebGL's parameters (no `TEXTURE_SWIZZLE_*`); `TexImageSource` uploads premultiply integer formats and accept `EXT_sRGB` formats.
- **Framebuffers**: on WebGL 1 an empty attachment point answers only `OBJECT_TYPE` (`INVALID_ENUM` otherwise); color attachment points past `MAX_COLOR_ATTACHMENTS` are `INVALID_ENUM` on both versions, without reaching ANGLE.
- **Drawing**: WebGL 2 contexts restart primitives at the fixed index, and `enable`/`disable`/`isEnabled` of `PRIMITIVE_RESTART_FIXED_INDEX` generate `INVALID_ENUM` (WebGL 2.0 §5.18).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `shaders-programs`, `textures`, `framebuffers`, `drawing`.

## Impact

- `crates/oxgl-core`: flagged shader and program slots, the checks above.
- `src/`: the shader/program liveness check, `OBJECT_NAME` on empty WebGL 1 points.
