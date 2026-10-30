# textures Specification

## Purpose
Covers texture and sampler objects, texture uploads from views, pixel unpack buffers and `TexImageSource` values, the WebGL unpack parameters, copies, immutable storage and the compressed-texture entry points (WebGL 1.0 §5.14.8, WebGL 2.0 §3.7.6, §3.7.13).

## Requirements

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

#### Scenario: Offset past the view
- **WHEN** `texImage3D` on WebGL 2 is given a view and a `srcOffset` past its end
- **THEN** `INVALID_OPERATION` is generated (cf. Khronos `conformance2/misc/views-with-offsets.html`)

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

### Requirement: Cross-origin document images are refused
Uploading a document image (an object with `naturalWidth` and an `ownerDocument`) whose URL has another origin than its document's, and that was not requested with CORS (`crossOrigin` unset), SHALL throw a `SecurityError` `DOMException` and upload nothing (WebGL 1.0 §4.2). `data:` and `blob:` URLs SHALL count as same-origin. A document without a string `URL` SHALL have no origins, and its images SHALL be accepted.

#### Scenario: Image from another origin
- **WHEN** `texImage2D` is given an image at `http://b.test/x.png` whose document is `http://a.test/page.html`
- **THEN** a `SecurityError` is thrown (cf. Khronos `conformance/textures/misc/origin-clean-conformance.html`)

#### Scenario: Same-origin, data URL and CORS images
- **WHEN** `texImage2D` is given a relative URL, an `http://a.test/` URL, a `data:` URL, or an `http://b.test/` image with `crossOrigin` set
- **THEN** each upload succeeds

### Requirement: Host-decoded document images
The JS layer SHALL let a host install an internal image decoder that, given a document image, returns its pixels as browsers decode them for WebGL: unpremultiplied RGBA, top row first, without gamma or color profiles. A document image SHALL be read through the decoder when one is installed and returns pixels, and through a 2D canvas otherwise. The decoder SHALL NOT be part of the public API.

#### Scenario: Alpha kept unpremultiplied
- **WHEN** a host's decoder returns the pixel `[255, 192, 128, 1]` and the image is uploaded without `UNPACK_PREMULTIPLY_ALPHA_WEBGL`
- **THEN** the texture holds `[255, 192, 128, 1]` (cf. Khronos `conformance/context/premultiplyalpha-test.html`)

### Requirement: 16-bit TexImageSource pixels
`TexImageSource` pixels given as a `Uint16Array` SHALL be read as RGBA16 and encoded at that precision for the upload's format and type.

#### Scenario: 10-bit upload from a 16-bit image
- **WHEN** an image decoded to RGBA16 with red `64/65535` is uploaded as `RGB10_A2`/`UNSIGNED_INT_2_10_10_10_REV`
- **THEN** the texel's red is `1/1023`, not 0 (cf. Khronos `conformance2/textures/misc/tex-image-10bpc.html`)

### Requirement: Host image objects through the decoder
A `TexImageSource` that is not ImageData-shaped, a canvas, a video or a document image SHALL be offered to the host's image decoder before it is rejected with a `TypeError`. Pixels the decoder marks `asIs`, an `ImageBitmap`'s, SHALL upload without `UNPACK_FLIP_Y_WEBGL` and `UNPACK_PREMULTIPLY_ALPHA_WEBGL` (WebGL 1.0 §5.14.8). A document image SHALL be offered to the decoder before an empty natural size makes it upload as 0×0.

#### Scenario: ImageBitmap from the host
- **WHEN** a host's decoder returns pixels for its `ImageBitmap` objects, and a page uploads one
- **THEN** the texture holds those pixels (cf. Khronos `conformance/textures/misc/exif-orientation.html`)

#### Scenario: ImageBitmap ignores flip and premultiply
- **WHEN** a host's decoder returns `asIs` pixels for an `ImageBitmap`, and it is uploaded with `UNPACK_FLIP_Y_WEBGL` and `UNPACK_PREMULTIPLY_ALPHA_WEBGL` set
- **THEN** the texture holds the pixels unflipped and unpremultiplied (cf. Khronos `conformance/textures/image_bitmap_from_image_data/`)

#### Scenario: SVG without a natural size
- **WHEN** an SVG image without `width` and `height` is uploaded before and after its element is given a size of 100×100
- **THEN** the first texture is 0×0 and the second is 100×100 (cf. Khronos `conformance/textures/misc/tex-image-svg-image-no-natural-width-and-height.html`)

### Requirement: Video frames from the host
Uploading a video element SHALL upload the frame the host's internal image decoder returns for it, and SHALL upload 0×0, as a video without data does in browsers, when there is no decoder or it returns none.

#### Scenario: Decoded video
- **WHEN** a host's decoder returns a 16×8 frame for a playing video, and the video is uploaded
- **THEN** the texture is 16×8 with that frame's pixels (cf. Khronos `conformance/textures/video/tex-2d-rgba-rgba-unsigned_byte.html`)
