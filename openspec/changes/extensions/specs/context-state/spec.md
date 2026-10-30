# Spec Delta

## ADDED Requirements

### Requirement: Extension parameters in getParameter
`getParameter` SHALL answer each parameter an extension adds only after that extension is enabled on the context, with the type its specification gives, and SHALL generate `INVALID_ENUM` for it before (WebGL 1.0 §5.14.14). `COMPRESSED_TEXTURE_FORMATS` SHALL list the formats of the enabled compressed-texture extensions.

#### Scenario: Compressed formats
- **WHEN** `WEBGL_compressed_texture_s3tc` is enabled, where supported
- **THEN** `getParameter(COMPRESSED_TEXTURE_FORMATS)` includes `COMPRESSED_RGB_S3TC_DXT1_EXT`
