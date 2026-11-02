# Tasks

## 1. Contract tests

- [x] 1.1 Add tests to `test/textures.test.mjs` for the Buffer-with-offset, plain `Uint8Array`, unpremultiplied-alpha and short-data scenarios. If any fails against the current code, stop and report it before changing code. Verify with `npm test`.
- [x] 1.2 Restrict `ImageData`-shaped sources in `imagePixels` (`src/context.ts`) to 8-bit typed arrays and `Uint16Array`, so another view falls through to the existing `TypeError` (or the host decoder). Use a realm-independent check (`ArrayBuffer.isView`, then the view's `Symbol.toStringTag`), never `instanceof`, so typed arrays from another realm still upload. Add the rejection scenarios' tests to `test/textures.test.mjs`, plus a test that a `Uint8ClampedArray` made with `vm.runInNewContext` uploads. Verify with `npm test`, and with `npm run conformance` on the `conformance/textures` and `conformance2/textures` pages, whose results must match `conformance/expectations.txt`.
- [x] 1.3 Add the three.js scenario to `test/threejs.test.mjs`, beside the existing `DataTexture` test, with `colorSpace` and `outputColorSpace` set, and `magFilter`/`minFilter` set to `NearestFilter` with `generateMipmaps` false as that test does, so pixels compare exactly. If three.js rejects or mishandles the plain object (it resizes or inspects images through DOM APIs, say), stop and report what it needs before changing anything. Verify with `npm test`.

## 2. Documentation

- [x] 2.1 Add an "Images and textures" section to `README.md` under Usage: what `texImage2D` accepts in Node; decoding a file to `{ width, height, data }` with `sharp` (`ensureAlpha().raw()`) and with `pngjs`; the `@napi-rs/canvas` route through a 2D canvas, noting that it premultiplies and so loses precision in semi-transparent pixels; and the three.js form (`new THREE.Texture(image)` with `needsUpdate`). Verify each example by running it in a scratch directory outside the repo with that library installed, so the repo gains no dependency, and `npm run lint` passes.
