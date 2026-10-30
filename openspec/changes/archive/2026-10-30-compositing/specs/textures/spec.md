## MODIFIED Requirements

### Requirement: Uploads from views
`texImage2D`, `texSubImage2D` and, on WebGL 2, `texImage3D` and `texSubImage3D` SHALL accept an `ArrayBufferView` (or `null` for zero-filled storage) whose type matches the pixel type, and SHALL generate `INVALID_OPERATION` for a mismatched type or a view smaller than the unpack parameters require (WebGL 1.0 §5.14.8, WebGL 2.0 §3.7.6). On WebGL 2 the `srcOffset` forms and, with a pixel unpack buffer bound, the `pboOffset` forms SHALL be supported.

#### Scenario: Sampled texture
- **WHEN** a 2×2 `RGBA`/`UNSIGNED_BYTE` texture with four colors is drawn on a full-viewport quad with `NEAREST` filtering
- **THEN** each quadrant of the drawing buffer reads its texel's color (cf. Khronos `conformance/textures/misc/texture-upload-size.html`)

#### Scenario: Wrong view type
- **WHEN** `texImage2D` with `FLOAT` type is given a `Uint8Array` on a context where `FLOAT` textures are allowed
- **THEN** `INVALID_OPERATION` is generated

#### Scenario: View too small
- **WHEN** `texImage2D` of a 4×4 `RGBA`/`UNSIGNED_BYTE` image is given 63 bytes
- **THEN** `INVALID_OPERATION` is generated and nothing past the view is read

#### Scenario: Offset past the view
- **WHEN** `texImage3D` on WebGL 2 is given a view and a `srcOffset` past its end
- **THEN** `INVALID_OPERATION` is generated (cf. Khronos `conformance2/misc/views-with-offsets.html`)
