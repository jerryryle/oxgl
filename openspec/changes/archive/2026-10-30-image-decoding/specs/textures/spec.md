## ADDED Requirements

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
