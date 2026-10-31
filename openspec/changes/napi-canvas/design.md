# Design

## Context

jsdom 30.1.3 loads `require("canvas")` (`lib/jsdom/utils.js`) and is written against node-canvas's API. It calls `createCanvas`, `new Image()` with `src = Buffer`, `toDataURL` and `toBuffer(callback)`, and it assigns `context.canvas`. It fires an image's `load` after `onLoad` returns, and it waits on a promise that `onLoad` returns (`per-document-resource-loader.js`). The runner also loads `canvas` itself (`conformance/page.mjs`, `run.mjs`, `offscreen.mjs`), for `createCanvas`, `Image`, `ImageData` and the `Image.prototype.src` accessor.

`@napi-rs/canvas` 1.1.0 ships `node-canvas.js`, a node-canvas compatibility module (`createCanvas`, `toBuffer(callback)`, stream and quality defaults). The `harness-2d-canvas` design rejected `@napi-rs/canvas` because it "is not a jsdom integration". That module didn't exist then and changes the answer. These were measured on macOS arm64 with jsdom 30.1.3 and `@napi-rs/canvas` 1.1.0:

| Behaviour | node-canvas 3 | `@napi-rs/canvas` (compat module) |
|---|---|---|
| `context.canvas = …` (jsdom does this in `getContext`) | writable | getter only, so jsdom throws `TypeError` |
| Image size after `src = buffer` | synchronous | synchronous |
| Image pixels after `src = buffer` | synchronous | decoded asynchronously; `drawImage` before then draws nothing |
| Undecodable bytes | `onerror` called synchronously | `onerror` called asynchronously |
| SVG with a size | synchronous | synchronous |
| SVG without a size | refused | 300×150 |
| `decode()` | — | promise; rejects on undecodable bytes |

With the fixes below in a scratch install, jsdom 30.1.3 gave a 2D context. PNG and JPEG `data:` images drawn in `load` read back their pixels, an undecodable image fired `error`, and `toBlob` produced a PNG.

## Goals / Non-Goals

**Goals:**
- `npm ci` and `require('canvas')` work on all five eventual targets from prebuilt binaries.
- Linux arm64 harness tests and both conformance suites keep their current results.

**Non-Goals:**
- Making `@napi-rs/canvas` match Cairo pixel for pixel in 2D drawing. Only conformance outcomes count.
- Porting oxgl itself to any new platform.

## Decisions

### A local `canvas` package, not an npm alias

`"canvas": "file:conformance/canvas"`, where `conformance/canvas/package.json` names a private package `canvas` whose `index.js` re-exports `require('@napi-rs/canvas/node-canvas')` after one adjustment: a `canvas` accessor on `CanvasRenderingContext2D.prototype` that keeps the original getter but lets an assigned value win. jsdom assigns the wrapping element there, which node-canvas allowed.

*Alternative:* `"canvas": "npm:@napi-rs/canvas@1.1.0"`. An alias resolves to the package root (`index.js`), not the compat module, and it can't carry the accessor fix, which jsdom needs before any 2D context works.

*Alternative:* patching jsdom (`patch-package` or a fork). That ties the fix to jsdom's internals across upgrades, while the shim depends only on the two public modules.

`@napi-rs/canvas` resolves from the symlinked `conformance/canvas` through the repository's `node_modules`, so it is pinned at the root as a devDependency. `conformance/` isn't in `package.json` `files`, so nothing is published.

### Hold `load` on the decode, in the runner

The runner wraps the per-document resource loader's `fetch` for image elements. Its `onLoad` calls jsdom's own, then returns the element's native image `decode()` promise. jsdom then fires `load` once pixels are ready. A rejection goes down jsdom's existing error path, which fires `error` and marks the image broken. This covers fetched and `data:` sources alike, because both go through that loader.

This lives in `page.mjs`, which already patches jsdom's image implementation (`ImageImpl`), rather than in the `canvas` shim, because it is about jsdom's event timing, not the canvas API. The shim stays a pure API adapter.

*Alternative:* re-dispatching `load` from a capturing listener on the window. It needs `stopImmediatePropagation`, a re-entrancy flag and care with listener order. Returning a promise uses a path jsdom already supports.

*Alternative:* synchronous decoding through a worker and `Atomics.wait`. That is far more machinery for the same result.

### Decoding for WebGL uses the decoded image

`decodeImage(bytes)` (the non-PNG path for uploads) creates a fresh `Image` and draws it at once, which is blank with `@napi-rs/canvas`. Uploads from an element come after its `load`, so they draw the element's already-decoded native image. `createImageBitmap` is asynchronous, so its byte path (Blobs) awaits `decode()` on a fresh image first. PNGs keep the runner's own decoder and SVGs keep the synchronous rasterize path, so neither changes.

### JPEG color profiles are ignored for WebGL uploads

Skia applies a JPEG's embedded ICC profile when decoding, as a browser's 2D canvas does. node-canvas never did. WebGL uploads ignore profiles, as the runner already does for PNGs. The first Linux arm64 run of this change failed `gl-teximage.html` in both suites: its colorspin JPEG uploaded red instead of the stored blue. So for a JPEG with an APP2 `ICC_PROFILE` segment, the load hold also decodes a copy of the bytes with those segments removed, and uploads use that copy. 2D drawing keeps the color-managed image. `createImageBitmap` from bytes removes the profile the same way. A JPEG without a profile is decoded once, as before.

*Alternative:* decoding the stripped copy at upload time. Uploads are synchronous, and the canvas package decodes asynchronously, so the copy has to be ready by `load`.

### The unsized-SVG shim stays

`@napi-rs/canvas` loads an SVG with no `width` or `height` as 300×150, while the spec wants a natural size of 0×0. The runner's existing `src`-accessor shim, which keeps such SVGs away from the package, still applies. It checks for the accessor and fails loudly if it's missing, so a future version without it fails at startup.

### Safety rules

The change touches only the JavaScript conformance runner and devDependencies. No Rust, `unsafe`, handle or ArrayBuffer-lifetime code changes.

## Risks / Trade-offs

- [Skia decodes JPEG or other formats differently from Cairo and libjpeg (rounding, chroma upsampling, EXIF orientation), which changes texture pages' results] → Task 3 compares every page outcome on Linux arm64 against the current expectations. A JPEG page that changes is checked against what browsers do, and either fixed in the runner or brought to the user before its expectation changes. `exif-orientation.html` covers orientation.
- [`load` now waits for a decode, so image-heavy pages run slightly longer] → Decoding happened before too, just synchronously, so the extra cost should be small. Task 3 compares each suite's run time with the current one.
- [A future `@napi-rs/canvas` or jsdom changes the API the shim relies on] → Both are pinned exactly. The shim and the load hold have harness tests (task 2), so an upgrade that breaks them fails `npm test`.
- [Nested resource loaders: frames get their own per-document loader] → The wrap is on the loader's prototype, so every document's loader gets it.

## Migration Plan

Land in one pull request. Rolling back means restoring the `canvas` pin and removing the shim, the load hold and the decode changes. No stored data or published artifacts are involved.
