# extensions Specification

## Purpose
Covers how a WebGL context lists and enables extensions (WebGL 1.0 §5.14.14), and the behaviour of each extension oxgl supports.

## Requirements

### Requirement: Extension queries on a lost context
On a lost or destroyed context, `getSupportedExtensions()` and `getExtension(name)` SHALL return `null` without generating an error (WebGL 1.0 §5.14).

#### Scenario: After destroy
- **WHEN** a context is destroyed and `getSupportedExtensions()` is called
- **THEN** it returns `null`

### Requirement: Extension list and objects
`getSupportedExtensions()` SHALL return a new array of the names of every WebGL extension oxgl implements that ANGLE can enable on the context. `getExtension(name)` SHALL compare names ASCII case-insensitively, enable a supported extension and return its object, the same object on every call for that context, and return `null` for any other name (WebGL 1.0 §5.14.14).

#### Scenario: Supported extensions
- **WHEN** a WebGL 1 context lists its extensions on the software backend
- **THEN** the list includes `OES_vertex_array_object`, `ANGLE_instanced_arrays`, `OES_texture_float` and `WEBGL_lose_context`, and each name in it returns a non-null object from `getExtension` (cf. Khronos `conformance/extensions/get-extension.html`)

#### Scenario: Same object, any case
- **WHEN** `getExtension('oes_vertex_array_object')` is called twice
- **THEN** both calls return the same object, whose class is `OES_vertex_array_object`

#### Scenario: Unknown name
- **WHEN** `getExtension('NOT_AN_EXTENSION')` is called
- **THEN** it returns `null` and no error is generated

#### Scenario: Missing argument
- **WHEN** `getExtension()` is called with no arguments
- **THEN** a `TypeError` is thrown

### Requirement: Extensions gate their features
A feature an extension adds (entry points, enums, formats, `getParameter` parameters, shader features) SHALL behave as before the extension until `getExtension` enables it, and as the extension's specification defines afterwards.

#### Scenario: Derivatives in shaders
- **WHEN** a WebGL 1 fragment shader using `#extension GL_OES_standard_derivatives : enable` and `dFdx` is compiled before and after `getExtension('OES_standard_derivatives')`
- **THEN** it fails to compile before and compiles after (cf. Khronos `conformance/extensions/oes-standard-derivatives.html`)

#### Scenario: Anisotropy parameter
- **WHEN** `getParameter(MAX_TEXTURE_MAX_ANISOTROPY_EXT)` is read before and after enabling `EXT_texture_filter_anisotropic`
- **THEN** it returns `null` with `INVALID_ENUM` before, and a number of at least 2 after

### Requirement: WebGL 1 extension entry points
On WebGL 1, `ANGLE_instanced_arrays`, `OES_vertex_array_object`, `WEBGL_draw_buffers` and `WEBGL_multi_draw` SHALL provide their entry points with the behavior of the matching WebGL 2 functions and extension specifications.

#### Scenario: Instanced draw on WebGL 1
- **WHEN** `ANGLE_instanced_arrays.drawArraysInstancedANGLE` draws two instances with a per-instance offset attribute
- **THEN** both instances render (cf. Khronos `conformance/extensions/angle-instanced-arrays.html`)

#### Scenario: Vertex array object on WebGL 1
- **WHEN** a vertex array created with `createVertexArrayOES` is bound with attribute 0 enabled, and then `bindVertexArrayOES(null)`
- **THEN** attribute 0 is disabled in the default vertex array, and `getParameter(VERTEX_ARRAY_BINDING_OES)` follows the binding (cf. Khronos `conformance/extensions/oes-vertex-array-object.html`)

#### Scenario: Two color attachments on WebGL 1
- **WHEN** `WEBGL_draw_buffers` is enabled and a framebuffer gets textures at `COLOR_ATTACHMENT0_WEBGL` and `COLOR_ATTACHMENT1_WEBGL` with `drawBuffersWEBGL` selecting both
- **THEN** the framebuffer is complete and a program writing `gl_FragData[1]` fills the second texture (cf. Khronos `conformance/extensions/webgl-draw-buffers.html`)

### Requirement: Float color buffers on WebGL 2
On WebGL 2, enabling `EXT_color_buffer_float` SHALL make `RGBA16F`, `RGBA32F`, `R11F_G11F_B10F` and the other float formats it lists color-renderable.

#### Scenario: Render to a half-float texture
- **WHEN** `EXT_color_buffer_float` is enabled and an `RGBA16F` texture is attached to a framebuffer
- **THEN** the framebuffer is complete, and incomplete without the extension (cf. Khronos `conformance2/extensions/ext-color-buffer-float.html`)

### Requirement: Compressed texture uploads
With a compressed-texture extension enabled, `compressedTexImage*` and `compressedTexSubImage*` SHALL upload its formats from client memory and, on WebGL 2, from the bound pixel unpack buffer with the `(imageSize, offset)` forms, generating `INVALID_OPERATION` when the form does not match whether a pixel unpack buffer is bound (WebGL 2.0 §3.7.6).

#### Scenario: Upload from a pixel unpack buffer
- **WHEN** `WEBGL_compressed_texture_s3tc` is enabled on WebGL 2 and one DXT1 block is uploaded from client memory, then from a bound pixel unpack buffer at offset 1
- **THEN** both uploads succeed, and each form generates `INVALID_OPERATION` in the other binding state (cf. Khronos `conformance/extensions/s3tc-and-rgtc.html`)

### Requirement: Debug extensions
`WEBGL_debug_renderer_info` SHALL report `GL_VENDOR` and `GL_RENDERER` through `UNMASKED_VENDOR_WEBGL` and `UNMASKED_RENDERER_WEBGL`, and `WEBGL_debug_shaders.getTranslatedShaderSource` SHALL return ANGLE's translated source of a compiled shader, or `''` before compilation.

#### Scenario: Unmasked renderer
- **WHEN** a software-backend context reads `UNMASKED_RENDERER_WEBGL`
- **THEN** it contains `SwiftShader`
