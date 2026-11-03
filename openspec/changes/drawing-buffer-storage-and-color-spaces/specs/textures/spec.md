## MODIFIED Requirements

### Requirement: WebGL unpack parameters
`UNPACK_FLIP_Y_WEBGL` and `UNPACK_PREMULTIPLY_ALPHA_WEBGL` SHALL apply to every `texImage2D` and `texSubImage2D` source, views included (WebGL 1.0 §5.14.3 `pixelStorei`). On WebGL 2, either one set with a 3D or 2D-array upload from a view, or with a pixel unpack buffer bound, SHALL generate `INVALID_OPERATION` (WebGL 2.0 §5.36). `UNPACK_COLORSPACE_CONVERSION_WEBGL` set to `NONE` SHALL turn off the color-space conversion of `TexImageSource` uploads, and SHALL have no other effect.

#### Scenario: Flipped view upload
- **WHEN** a 1×2 texture is uploaded from a view with red in its first row and green in its second, with `UNPACK_FLIP_Y_WEBGL` true
- **THEN** sampling the texture's bottom row reads green (cf. Khronos `conformance/textures/misc/tex-image-with-format-and-type.html`)

#### Scenario: Premultiplied view upload
- **WHEN** an `RGBA`/`UNSIGNED_BYTE` texel `[255, 255, 255, 128]` is uploaded with `UNPACK_PREMULTIPLY_ALPHA_WEBGL` true
- **THEN** it samples as `[128, 128, 128, 128]` within one unit

#### Scenario: Conversion turned off
- **WHEN** `unpackColorSpace` is `"display-p3"`, `UNPACK_COLORSPACE_CONVERSION_WEBGL` is `NONE`, and an `ImageData`-shaped red pixel is uploaded
- **THEN** the texture samples `[255, 0, 0, 255]`

## ADDED Requirements

### Requirement: unpackColorSpace
`unpackColorSpace` SHALL start as `"srgb"` and accept `"srgb"` or `"display-p3"`, ignoring any other assigned value as WebIDL does for enumeration attributes (WebGL 1.0 §5.14.1). A `TexImageSource` upload SHALL convert the source's pixels from the source's color space into `unpackColorSpace` before any other conversion, unless `UNPACK_COLORSPACE_CONVERSION_WEBGL` is `NONE` (WebGL 1.0 §5.14.8). Uploads from views SHALL NOT be converted.

#### Scenario: sRGB red into Display P3
- **WHEN** `unpackColorSpace` is `"display-p3"` and an `ImageData`-shaped `[255, 0, 0, 255]` pixel is uploaded as `RGBA`/`UNSIGNED_BYTE`
- **THEN** the texture samples `[234, 51, 35, 255]` within two units (cf. Khronos `conformance/textures/video/tex-2d-rgba-rgba-unsigned_byte.html`, which expects these values within six)

#### Scenario: Same color space
- **WHEN** `unpackColorSpace` is `"srgb"` and an `ImageData`-shaped `[200, 100, 50, 255]` pixel is uploaded
- **THEN** the texture samples exactly `[200, 100, 50, 255]`

#### Scenario: View uploads are not converted
- **WHEN** `unpackColorSpace` is `"display-p3"` and a `Uint8Array` `[255, 0, 0, 255]` is uploaded
- **THEN** the texture samples `[255, 0, 0, 255]`

### Requirement: Color space of upload sources
A source's color space SHALL be:
- the `colorSpace` property of an `ImageData`-shaped object when it is `"srgb"` or `"display-p3"`, else `"srgb"`;
- the `drawingBufferColorSpace` of an oxgl context's canvas;
- `"srgb"` for every other source.

Converting from Display P3 into sRGB SHALL clamp colors outside the sRGB gamut.

#### Scenario: Display P3 ImageData into sRGB
- **WHEN** `unpackColorSpace` is `"srgb"` and an `ImageData`-shaped object with `colorSpace: "display-p3"` and pixel `[234, 51, 35, 255]` is uploaded
- **THEN** the texture samples `[255, 0, 0, 255]` within two units

#### Scenario: Canvas of a Display P3 context
- **WHEN** context A has `drawingBufferColorSpace` `"display-p3"` and is cleared to `(234, 51, 35) / 255`, opaque, and context B with `unpackColorSpace` `"srgb"` uploads `A.canvas`
- **THEN** B's texture samples `[255, 0, 0, 255]` within two units

#### Scenario: Out-of-gamut color clamped
- **WHEN** an `ImageData`-shaped object with `colorSpace: "display-p3"` and pixel `[0, 255, 0, 255]` is uploaded with `unpackColorSpace` `"srgb"`
- **THEN** the texture samples `[0, 255, 0, 255]`, the clamped sRGB green

### Requirement: ImageBitmap color conversion
An `ImageBitmap`'s pixels SHALL be converted between color spaces as other sources are.

Accepted trade-off: those pixels may already be premultiplied, and they are converted as if they were not. Translucent pixels of a premultiplied bitmap converted between color spaces can be off by a few units.

#### Scenario: Opaque bitmap converted
- **WHEN** a conformance page uploads an opaque red `ImageBitmap` with `unpackColorSpace` `"display-p3"`
- **THEN** the texture samples `[234, 51, 35, 255]` within two units
