# Spec Delta

## Purpose

Covers texture and sampler objects, texture uploads from views, pixel unpack buffers and `TexImageSource` values, the WebGL unpack parameters, copies, immutable storage and the compressed-texture entry points (WebGL 1.0 §5.14.8, WebGL 2.0 §3.7.6, §3.7.13).

## ADDED Requirements

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

### Requirement: WebGL unpack parameters
`UNPACK_FLIP_Y_WEBGL` and `UNPACK_PREMULTIPLY_ALPHA_WEBGL` SHALL apply to every `texImage2D` and `texSubImage2D` source, views included (WebGL 1.0 §5.14.3 `pixelStorei`). On WebGL 2, either one set with a 3D or 2D-array upload from a view, or with a pixel unpack buffer bound, SHALL generate `INVALID_OPERATION` (WebGL 2.0 §5.36). `UNPACK_COLORSPACE_CONVERSION_WEBGL` SHALL have no effect on oxgl's sources.

#### Scenario: Flipped view upload
- **WHEN** a 1×2 texture is uploaded from a view with red in its first row and green in its second, with `UNPACK_FLIP_Y_WEBGL` true
- **THEN** sampling the texture's bottom row reads green (cf. Khronos `conformance/textures/misc/tex-image-with-format-and-type.html`)

#### Scenario: Premultiplied view upload
- **WHEN** an `RGBA`/`UNSIGNED_BYTE` texel `[255, 255, 255, 128]` is uploaded with `UNPACK_PREMULTIPLY_ALPHA_WEBGL` true
- **THEN** it samples as `[128, 128, 128, 128]` within one unit

### Requirement: TexImageSource uploads
The `TexImageSource` forms of `texImage2D`, `texSubImage2D`, `texImage3D` and `texSubImage3D` SHALL accept an `ImageData`-shaped object, an oxgl context's canvas, an object with a 2D context, or a document image, convert its RGBA8 pixels to the requested format and type (WebGL 1.0 §5.14.8, WebGL 2.0 §3.7.6), and throw `TypeError` for any other value. On WebGL 2 a bound pixel unpack buffer SHALL make these forms generate `INVALID_OPERATION`.

#### Scenario: ImageData-shaped source
- **WHEN** `texImage2D(TEXTURE_2D, 0, RGB, RGB, UNSIGNED_SHORT_5_6_5, { width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) })` is called and the texture is sampled
- **THEN** it reads red (cf. Khronos `conformance/textures/misc/tex-image-and-sub-image-2d-with-image-data.html`)

#### Scenario: Image element in a page
- **WHEN** a conformance page uploads a loaded PNG `<img>`
- **THEN** the texture holds the PNG's pixels (cf. Khronos `conformance/textures/image/tex-2d-rgba-rgba-unsigned_byte.html`)

#### Scenario: Canvas of another context
- **WHEN** context A clears to blue and context B uploads `A.canvas`
- **THEN** B's texture samples blue

#### Scenario: Unsupported source
- **WHEN** `texImage2D(TEXTURE_2D, 0, RGBA, RGBA, UNSIGNED_BYTE, {})` is called
- **THEN** a `TypeError` is thrown

### Requirement: Copies and immutable storage
`copyTexImage2D`, `copyTexSubImage2D` and, on WebGL 2, `copyTexSubImage3D`, `texStorage2D` and `texStorage3D` SHALL behave as WebGL 1.0 §5.14.8 and WebGL 2.0 §3.7.6 specify, copying from the resolved drawing buffer when it is antialiased.

#### Scenario: Copy from an antialiased drawing buffer
- **WHEN** an antialiased context is cleared to green and `copyTexImage2D` copies it into a texture that is then sampled
- **THEN** the texture reads green and no error is generated (cf. Khronos `conformance/textures/misc/copy-tex-image-and-sub-image-2d.html`)

#### Scenario: Immutable storage
- **WHEN** `texStorage2D` allocates a texture and `texImage2D` is then called on it
- **THEN** `INVALID_OPERATION` is generated

### Requirement: Compressed texture entry points
`compressedTexImage2D`, `compressedTexSubImage2D` and, on WebGL 2, their 3D forms SHALL exist and SHALL generate `INVALID_ENUM` for any format no enabled extension provides (WebGL 1.0 §5.14.8).

#### Scenario: No compressed formats yet
- **WHEN** `compressedTexImage2D` is called with `COMPRESSED_RGB_S3TC_DXT1_EXT` before its extension is enabled
- **THEN** `INVALID_ENUM` is generated

### Requirement: Samplers
On WebGL 2, `createSampler`, `deleteSampler`, `isSampler`, `bindSampler`, `samplerParameterf/i` and `getSamplerParameter` SHALL behave as WebGL 2.0 §3.7.13 specifies, with `WebGLSampler` following the `webgl-objects` rules. A sampler bound to a unit SHALL override the texture's sampling parameters there.

#### Scenario: Sampler overrides texture filtering
- **WHEN** a texture with `LINEAR` filtering is sampled through a unit whose bound sampler sets `NEAREST`
- **THEN** sampling is nearest, and `getParameter(SAMPLER_BINDING)` returns the sampler
