# Spec Delta

## ADDED Requirements

### Requirement: WebGL 1 depth textures
On WebGL 1, uploads with format `DEPTH_COMPONENT` or `DEPTH_STENCIL` SHALL generate `INVALID_ENUM` until `WEBGL_depth_texture` is enabled, and then `INVALID_OPERATION` unless they are `texImage2D` on `TEXTURE_2D`, level 0, without data.

#### Scenario: Depth texture with data
- **WHEN** `WEBGL_depth_texture` is enabled and `texImage2D(TEXTURE_2D, 0, DEPTH_COMPONENT, 1, 1, 0, DEPTH_COMPONENT, UNSIGNED_SHORT, new Uint16Array(1))` is called
- **THEN** it generates `INVALID_OPERATION` (cf. Khronos `conformance/extensions/webgl-depth-texture.html`)

### Requirement: TexImageSource format table and row lengths
`TexImageSource` uploads SHALL accept integer formats only with `UNSIGNED_BYTE` (WebGL 2.0 §3.7.6), and every upload whose row (the row length, or the width when it is 0) is shorter than `width + UNPACK_SKIP_PIXELS` SHALL generate `INVALID_OPERATION` (WebGL 2.0 §5.35).

#### Scenario: RGB10_A2UI from a canvas
- **WHEN** a canvas is uploaded as `RGB10_A2UI`/`RGBA_INTEGER`/`UNSIGNED_INT_2_10_10_10_REV`
- **THEN** an error is generated (cf. Khronos `conformance2/textures/misc/tex-image-with-bad-args-from-dom-elements.html`)
