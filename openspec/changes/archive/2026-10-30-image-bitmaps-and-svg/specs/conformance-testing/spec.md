## ADDED Requirements

### Requirement: ImageBitmaps in pages
The runner SHALL provide `createImageBitmap` for Blobs, images, ImageData and canvases, honoring `imageOrientation: 'flipY'` and `premultiplyAlpha: 'premultiply'`, and `fetch` when jsdom has none. Image bitmaps SHALL upload with the pixels they were created from, JPEGs upright for their EXIF orientation.

#### Scenario: Bitmap from a fetched JPEG
- **WHEN** a page fetches a JPEG with an EXIF orientation, creates an ImageBitmap from its Blob and uploads it
- **THEN** the texture shows the image upright (cf. Khronos `conformance/textures/misc/exif-orientation.html`)

### Requirement: SVG images at the element's size
The runner SHALL draw SVG images for uploads from their bytes at the element's size, and SHALL load an SVG whose root has no `width` or `height` with no natural size instead of failing.

#### Scenario: Unsized SVG
- **WHEN** a page loads an SVG with only a `viewBox`
- **THEN** its `load` event fires and its natural size is 0×0
