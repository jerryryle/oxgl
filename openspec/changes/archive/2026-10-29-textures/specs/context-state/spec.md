# Spec Delta

## ADDED Requirements

### Requirement: Texture and sampler bindings in getParameter
`getParameter` SHALL return the texture object bound to the active unit, or `null`, for `TEXTURE_BINDING_2D`, `TEXTURE_BINDING_CUBE_MAP` and, on WebGL 2, `TEXTURE_BINDING_3D` and `TEXTURE_BINDING_2D_ARRAY`, and on WebGL 2 the active unit's sampler for `SAMPLER_BINDING` (WebGL 1.0 §5.14.3, WebGL 2.0 §3.7.2).

#### Scenario: Deleted texture unbinds
- **WHEN** the texture bound to `TEXTURE_2D` on the active unit is deleted
- **THEN** `getParameter(TEXTURE_BINDING_2D)` returns `null`
