## ADDED Requirements

### Requirement: Images decoded as for WebGL
The runner SHALL decode PNG images it fetched for WebGL uploads itself: gamma and color profiles ignored, alpha unpremultiplied, 16-bit samples kept. It SHALL rasterize SVG images at the element's size, and write a WebGL canvas's `toDataURL` PNG from its unpremultiplied pixels. Other images SHALL go through the canvas package.

#### Scenario: Gamma and 16-bit PNGs
- **WHEN** a page uploads PNGs with gamma chunks, color profiles, palettes and 16-bit samples
- **THEN** the textures hold the stored values (cf. Khronos `conformance/textures/misc/gl-teximage.html`)

#### Scenario: Resized SVG image
- **WHEN** a page doubles an SVG image's `width` and `height` and uploads it
- **THEN** the texture has the doubled size (cf. Khronos `conformance/textures/misc/texture-upload-size.html`)

### Requirement: Image width changes do not reload
In the runner, changing an image's `width` attribute SHALL NOT reload it unless it has `srcset` or `sizes`, as in Chromium.

#### Scenario: Width doubled in the load handler
- **WHEN** a page's image load handler doubles the image's `width`
- **THEN** the handler is not called again
