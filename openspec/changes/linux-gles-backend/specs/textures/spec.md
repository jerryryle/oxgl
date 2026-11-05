## MODIFIED Requirements

### Requirement: Texture objects
`createTexture`, `bindTexture`, `deleteTexture`, `isTexture`, `texParameterf`, `texParameteri`, `getTexParameter` and `generateMipmap` SHALL behave as WebGL 1.0 §5.14.8 and WebGL 2.0 §3.7.6 specify, with `WebGLTexture` following the `webgl-objects` rules. Binding a texture to a target other than its first SHALL generate `INVALID_OPERATION`.

#### Scenario: Bind per unit
- **WHEN** texture A is bound to `TEXTURE_2D` on unit 0 and texture B on unit 1
- **THEN** `getParameter(TEXTURE_BINDING_2D)` returns A after `activeTexture(TEXTURE0)` and B after `activeTexture(TEXTURE1)` (cf. Khronos `conformance/textures/misc/texture-active-bind.html`)

#### Scenario: Target mismatch
- **WHEN** a texture bound to `TEXTURE_2D` is bound to `TEXTURE_CUBE_MAP`
- **THEN** `INVALID_OPERATION` is generated and the cube map binding is unchanged

#### Scenario: Parameters
- **WHEN** `texParameteri(TEXTURE_2D, TEXTURE_MIN_FILTER, NEAREST)` is called
- **THEN** `getTexParameter(TEXTURE_2D, TEXTURE_MIN_FILTER)` is `NEAREST` (cf. Khronos `conformance/textures/misc/texture-mips.html`)

#### Scenario: Mipmaps of a float texture without linear filtering
- **WHEN** a WebGL 1 context on the OpenGL ES backend, on a driver without `OES_texture_float_linear`, enables `OES_texture_float` and calls `generateMipmap` on an `RGBA` float texture
- **THEN** `INVALID_OPERATION` is generated and the context is not lost (cf. Khronos `conformance/extensions/oes-texture-float-linear.html`)
