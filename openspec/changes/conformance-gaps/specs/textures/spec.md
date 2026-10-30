# Spec Delta

## ADDED Requirements

### Requirement: A texture must be bound
Texture parameter, upload, copy, storage and mipmap calls SHALL generate `INVALID_OPERATION` when no texture is bound to the target they name, for targets the call accepts (WebGL 1.0 §5.14.8); an invalid target SHALL still generate `INVALID_ENUM`.

#### Scenario: Upload with no texture bound
- **WHEN** `texImage2D(TEXTURE_2D, …)` is called with no texture bound to `TEXTURE_2D`
- **THEN** it generates `INVALID_OPERATION` (cf. Khronos `conformance/misc/null-object-behaviour.html`)

### Requirement: WebGL's texture parameters
`texParameter*` and `getTexParameter` SHALL accept only the texture parameters of the WebGL version and enabled extensions, generating `INVALID_ENUM` for others such as `TEXTURE_SWIZZLE_R` (WebGL 2.0 §5.19).

#### Scenario: Swizzle rejected
- **WHEN** `texParameteri(TEXTURE_2D, 0x8E42, RED)` is called on WebGL 2
- **THEN** it generates `INVALID_ENUM` (cf. Khronos `conformance2/state/gl-enum-tests.html`)

### Requirement: TexImageSource formats
`TexImageSource` uploads SHALL premultiply integer formats when `UNPACK_PREMULTIPLY_ALPHA_WEBGL` is set, and SHALL accept `EXT_sRGB`'s `SRGB_EXT` and `SRGB_ALPHA_EXT` formats.

#### Scenario: Premultiplied integer upload
- **WHEN** an `ImageData` with a transparent red pixel is uploaded as `R8UI` with premultiplication
- **THEN** that texel reads `0` (cf. Khronos `conformance2/textures/image_data/tex-2d-r8ui-red_integer-unsigned_byte.html`)
