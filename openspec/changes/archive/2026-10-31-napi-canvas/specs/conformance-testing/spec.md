# Spec Delta

## ADDED Requirements

### Requirement: One canvas backend on every target
The `canvas` package the runner uses SHALL install from prebuilt binaries, without a compiler or system libraries, on each of oxgl's eventual targets (Linux x64, Linux arm64, macOS arm64, Windows x64, Windows arm64), and SHALL be the same 2D and image backend on all of them.

#### Scenario: Install on Windows arm64
- **WHEN** `npm ci` runs on a Windows arm64 host with no GTK, Cairo or build tools for native modules
- **THEN** it succeeds, and `require('canvas')` from the repository root loads

#### Scenario: Same backend everywhere
- **WHEN** the installed `canvas` package is inspected on any two of the eventual targets
- **THEN** both resolve to the same backend package at the same pinned version

## MODIFIED Requirements

### Requirement: Images load and decode
Image elements in a page SHALL load their source from the suite, fire `load` with their natural size, and be drawable into a 2D context, which then reads back their decoded pixels. An image SHALL fire `load` only once its pixels are decoded, so drawing it from its `load` handler reads them. An image whose source cannot be loaded or decoded SHALL fire `error` and not `load`.

#### Scenario: Image drawn into a 2D canvas
- **WHEN** a page loads a suite PNG into an `<img>`, waits for `load`, draws it into a 2D canvas and calls `getImageData`
- **THEN** the pixels match the PNG's (cf. Khronos `conformance/textures/image/tex-2d-rgba-rgba-unsigned_byte.html`)

#### Scenario: Image drawn in its load handler
- **WHEN** a page sets an `<img>` source to a JPEG `data:` URL and, in the `load` handler, draws the image into a 2D canvas and calls `getImageData`
- **THEN** the pixels are the JPEG's, not transparent black

#### Scenario: Missing image
- **WHEN** a page sets an `<img>` source to a path the suite does not have
- **THEN** the image fires `error`

#### Scenario: Undecodable image
- **WHEN** a page sets an `<img>` source to bytes that are not an image
- **THEN** the image fires `error` and never `load`

### Requirement: Images decoded as for WebGL
The runner SHALL decode PNG images it fetched for WebGL uploads itself: gamma and color profiles ignored, alpha unpremultiplied, 16-bit samples kept. It SHALL rasterize SVG images at the element's size, and write a WebGL canvas's `toDataURL` PNG from its unpremultiplied pixels. Other images SHALL go through the canvas package, with embedded color profiles ignored for WebGL uploads.

#### Scenario: Gamma and 16-bit PNGs
- **WHEN** a page uploads PNGs with gamma chunks, color profiles, palettes and 16-bit samples
- **THEN** the textures hold the stored values (cf. Khronos `conformance/textures/misc/gl-teximage.html`)

#### Scenario: JPEG with a color profile
- **WHEN** a page sets `UNPACK_COLORSPACE_CONVERSION_WEBGL` to `NONE` and uploads a JPEG whose embedded profile maps its stored blue to red
- **THEN** the texture holds the stored blue (cf. Khronos `conformance/textures/misc/gl-teximage.html`)

#### Scenario: Resized SVG image
- **WHEN** a page doubles an SVG image's `width` and `height` and uploads it
- **THEN** the texture has the doubled size (cf. Khronos `conformance/textures/misc/texture-upload-size.html`)
