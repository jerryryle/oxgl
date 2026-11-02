## ADDED Requirements

### Requirement: Pixels from image libraries
An `ImageData`-shaped source's `data` SHALL be accepted as any 8-bit typed array, including a Node `Buffer` that starts partway into its `ArrayBuffer`, and read from its own first byte as `width × height` RGBA8 pixels, top row first and unpremultiplied, with the WebGL unpack parameters applied (WebGL 1.0 §5.14.8). A `data` holding fewer pixels than the upload needs SHALL generate `INVALID_OPERATION`.

#### Scenario: Buffer with a byte offset
- **WHEN** a 2×1 source's `data` is a `Buffer` that is a subarray at byte offset 3 of a larger buffer, holding red then green, and is uploaded as `RGBA`/`UNSIGNED_BYTE`
- **THEN** the texture's left texel samples red and its right texel green

#### Scenario: Plain Uint8Array
- **WHEN** a 1×1 source with `data: new Uint8Array([0, 0, 255, 255])` is uploaded
- **THEN** the texel samples blue

#### Scenario: Alpha kept unpremultiplied
- **WHEN** a 1×1 source with `data` `[255, 0, 0, 128]` is uploaded as `RGBA`/`UNSIGNED_BYTE` without `UNPACK_PREMULTIPLY_ALPHA_WEBGL`
- **THEN** the texel reads `[255, 0, 0, 128]`

#### Scenario: Short data
- **WHEN** a source declares `width: 2, height: 2` with 12 bytes of `data` and is uploaded
- **THEN** `INVALID_OPERATION` is generated and the texture is not redefined

#### Scenario: three.js texture image
- **WHEN** a three.js `Texture` whose `image` is a 2×2 `{ width, height, data }` object, with `needsUpdate` set, maps a quad that three.js renders
- **THEN** each quadrant shows its source pixel, with the source's top row at the top of the quad

### Requirement: Other pixel views are not ImageData
An object whose `data` is a view other than an 8-bit typed array or the `Uint16Array` of 16-bit pixels, such as a float array, SHALL NOT be taken as `ImageData`-shaped, so the upload throws the `TypeError` of an unsupported `TexImageSource`.

#### Scenario: Float pixels rejected
- **WHEN** `texImage2D(TEXTURE_2D, 0, RGBA, RGBA, UNSIGNED_BYTE, { width: 1, height: 1, data: new Float32Array([1, 0, 0, 1]) })` is called
- **THEN** a `TypeError` is thrown and the texture is not redefined

#### Scenario: Other wide views and DataView rejected
- **WHEN** the same upload is made with `data` an `Int16Array`, a `Uint32Array` or a `DataView`, each with enough bytes for one RGBA8 pixel
- **THEN** each throws a `TypeError`

#### Scenario: Signed bytes accepted
- **WHEN** the same upload is made with `data: new Int8Array([127, 0, 0, 127])`
- **THEN** no exception is thrown and the texel reads `[127, 0, 0, 127]`

#### Scenario: Typed array from another realm
- **WHEN** a 1×1 source's `data` is a `Uint8ClampedArray` created in another realm (`vm.runInNewContext`) holding red, and is uploaded
- **THEN** no exception is thrown and the texel samples red
