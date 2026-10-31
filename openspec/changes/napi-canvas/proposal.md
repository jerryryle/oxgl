# Proposal

## Why

The conformance runner's `canvas` devDependency (node-canvas 3) has no prebuilt binary for Windows arm64. `npm ci` falls back to compiling it against GTK and fails, so nothing in the repository installs on that platform, and the platform survey (linux-arm64-focus task 4.2) stops before it starts. `@napi-rs/canvas` (Skia, MIT) ships prebuilt binaries for all five eventual targets and needs no system libraries. Using it on every host also keeps one 2D and image backend everywhere, so a conformance difference between platforms points at oxgl rather than at the canvas library.

## What Changes

- **`canvas` is a local compatibility package.** The `canvas` devDependency becomes `file:conformance/canvas`: a private package named `canvas` that exports `@napi-rs/canvas`'s node-canvas compatibility module, adjusted where jsdom 30 relies on node-canvas behavior. jsdom and the runner keep loading it with `require('canvas')`. `@napi-rs/canvas` is pinned exactly as a devDependency. node-canvas leaves the dependency tree.
- **Images fire `load` once their pixels are decoded.** `@napi-rs/canvas` gives an image its size at once but decodes its pixels asynchronously, and reports undecodable bytes asynchronously. jsdom fires `load` straight after setting the source. The runner holds an image's `load` until its decode finishes, and turns a failed decode into `error`, so a page that draws an image in its `load` handler reads its pixels, as in a browser.
- **The runner's own non-PNG decoding uses the decoded image.** WebGL uploads from an image element use the element's already-decoded image, and `createImageBitmap` awaits decoding, instead of decoding bytes synchronously through the canvas package. A JPEG's embedded color profile, which Skia applies and node-canvas ignored, is ignored for WebGL uploads, as a PNG's already is.
- **Docs**: `README.md` and `CONTRIBUTING.md` name the new backend.

Out of scope:
- Porting to Windows arm64 or any other platform. This change only removes the install blocker. Each port stays a change of its own under linux-arm64-focus task 4.3.
- Any change to oxgl's published package or its runtime dependencies. Both packages are devDependencies, used only by the conformance runner, and are not published.
- New conformance coverage. The bar is the current Linux arm64 results.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `conformance-testing`: the runner's 2D and image backend installs from prebuilt binaries on every eventual target, the same on all of them; and an image's `load` fires only once its pixels can be drawn, with an undecodable image firing `error`.

## Impact

- `package.json` / `package-lock.json`: `canvas` becomes `file:conformance/canvas`, `@napi-rs/canvas` is added and pinned. The install shrinks from about 53 MB (node-canvas with Cairo) to about 29 MB.
- New `conformance/canvas/` (`package.json`, `index.js`). It is not in the published `files`.
- `conformance/page.mjs`: the image load hold, and the decode paths for uploads and `createImageBitmap`. `conformance/offscreen.mjs` and `conformance/run.mjs` load `canvas` as before.
- `test/conformance-harness.test.mjs`: cases for drawing in `load` and for an undecodable image.
- `conformance/expectations.txt`: unchanged if results hold. Any change in results is reviewed per page before it lands.
- `README.md` (the macOS note on canvas image decoding) and `CONTRIBUTING.md` (the runner's `canvas` dependency).
- Licensing: neither package is distributed, so the licensing capability's bundled-dependency rules don't apply. `THIRD_PARTY_NOTICES` is unchanged.
