# Proposal

## Why

Node has no image decoder, and oxgl's README never says how to get an image file into a texture. oxgl already uploads any `{ width, height, data }` object exactly, unpremultiplied and top row first, which is what image libraries such as `sharp` and `pngjs` produce, but nothing documents it or pins down the contract (which arrays, what happens when `data` is short), and nothing checks that three.js takes such an object as a texture image.

A public image-decoder hook was considered and rejected: `texImage2D` is synchronous, so a hook cannot call an async decoder, and for canvas-library image objects it can only read pixels back through a 2D canvas, which loses alpha precision. Decoding to plain pixels first gives exact results with no new API.

## What Changes

- **The textures spec pins the existing contract for `ImageData`-shaped sources**: `data` may be any `Uint8Array`-family view, Node `Buffer`s with a byte offset included, read as RGBA8 top row first and unpremultiplied; a `Uint16Array` is read as RGBA16 (already specified); a `data` shorter than `width × height` pixels generates `INVALID_OPERATION`.
- **Other views are rejected.** Today an object whose `data` is, say, a `Float32Array` uploads its raw bytes as RGBA8, scrambling the colors with no error. It will throw the `TypeError` any unsupported source gets.
- **A three.js texture whose image is such an object uploads and renders**, checked by a test.
- **The README gains an "Images and textures" section**: decoding with an image library to `{ width, height, data }`, the 2D-canvas route (`@napi-rs/canvas`) and its alpha precision loss, and the three.js form (`new THREE.Texture(image)` with `needsUpdate`).

Apart from rejecting other views, no behavior changes if the tests confirm what the code does today. If one shows otherwise (three.js rejecting a plain object, say), the fix is reported before it is made.

### Out of scope

- A public image-decoder hook; the internal one stays internal.
- Bundled image decoders, or an `Image`/`ImageBitmap` class.
- Loading three.js assets from disk (`TextureLoader`, `GLTFLoader`); a separate, undecided change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `textures`: adds a requirement pinning what an `ImageData`-shaped source's `data` may be, how a short one fails and that other views are rejected, with a three.js scenario.

## Impact

- `src/context.ts`: `imagePixels` checks the view type of `data`.
- `test/textures.test.mjs` and `test/threejs.test.mjs` gain tests.
- `README.md` gains a section.
- No dependency changes.
