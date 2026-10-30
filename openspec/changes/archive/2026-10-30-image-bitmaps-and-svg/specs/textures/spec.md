## ADDED Requirements

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
