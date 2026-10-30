# Proposal

## Why

The conformance runner gives pages a browser without a 2D canvas, image decoding or a working `postMessage`. As oxgl's API grows, pages get further and then fail or hang on the runner rather than on oxgl:

- **2D canvas and images.** jsdom provides them only when the optional `canvas` package is installed. Without it, `getContext('2d')` returns `null` and images never load, so the runner currently fails every image with an `error` event. About 80 pages fail on `getImageData` or `drawImage` of a null context. The `textures/image`, `textures/canvas` and `textures/webgl_canvas` pages can't build their sources at all.
- **`postMessage` to itself.** jsdom delivers a window's message to itself with `event.source === null`. `setZeroTimeout` in the suite's `js/webgl-test-utils.js` accepts only messages whose source is the window, so every callback queued through it, including those from `wtu.dispatchPromise`, never runs. Pages built on it hang until the 20 s limit: `textures/video`, `textures/canvas`, `textures/webgl_canvas`, `context/context-creation*`, `rendering/blending` and others. Measured in jsdom 30.1.3. After the `context-state` change, about 120 such pages time out.

For a compliance measurement, the runner must behave like a browser wherever it can. Then each remaining failure is oxgl's own, for example a missing `TexImageSource` upload, and not an artifact of the runner.

## What Changes

- **Real 2D canvas and images.** `canvas` (node-canvas 3, MIT) becomes a pinned devDependency, used only by the conformance runner, and jsdom then supplies working 2D contexts and decodes images. The runner stops failing images: they load, fire `load`, and can be drawn and read back. It still fails video and audio, as before.
- **`getContext('2d')`** on a page canvas returns jsdom's 2D context instead of `null`. A canvas keeps the first context type it was given, as in a browser (HTML §4.12.5, `getContext`).
- **`postMessage`** is delivered with `source` set to the receiving window, so the suite's `setZeroTimeout` and `dispatchPromise` work. It is exact for a page posting to itself, the only case the suite reads `source` for.
- **`ImageData`** is a page global (backed by node-canvas), as in a browser.
- **Video and audio** report no playable type (`canPlayType` returns `""`) and `play()` rejects with `NotSupportedError`, as a browser without codecs does, so media pages finish instead of hanging.
- The runner fails at startup with a clear message when `canvas` is missing, rather than silently running pages without it.
- Conformance expectations are regenerated, and the pages whose outcome changed are recorded.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `conformance-testing`:
  - "Pages obtain oxgl contexts through canvas" now hands out real 2D contexts.
  - "Unsupported media fails promptly" covers only video and audio.
  - New requirements cover image decoding, `postMessage` delivering a `source` (exact for a page posting to itself), `ImageData`, and the startup check for the canvas package.

## Impact

- `package.json` / `package-lock.json`: `canvas` as a pinned devDependency. It installs a prebuilt binary with Cairo bundled, about 53 MB, on Linux arm64 and macOS arm64. npm never installs it for users of `oxgl`, and it is not part of the published package, so the licensing capability's rules for bundled dependencies don't apply.
- `conformance/page.mjs` (the shim), `test/conformance-harness.test.mjs` and its fixtures, `CONTRIBUTING.md`, `conformance/expectations.txt`.
- No oxgl library code changes.
- Ordering: this change follows `context-state` and precedes `drawing-buffer`. Both modify the conformance requirement "Pages obtain oxgl contexts through canvas", so `drawing-buffer`'s delta is rebased on this one's text (task 4.1).

## Out of Scope and Extension Points

- **oxgl's `TexImageSource` uploads.** Pages that call `texImage2D` with an image, canvas or `ImageData` will keep failing until the textures change adds those overloads. This change makes those failures real API failures.
- **Reading a WebGL canvas from 2D drawing.** `drawImage(webglCanvas)` and `webglCanvas.toDataURL()` see a blank node-canvas, because the canvas package can't read oxgl's drawing buffer. Making them see the drawing buffer belongs with the textures change.
- **Video decoding**, `createImageBitmap` and `ImageBitmap`, and `OffscreenCanvas`. Video stays "no playable type". `ImageBitmap` comes with the textures change.
- Pages that hang because a script throws inside an `async` function or a `startUnit` the page never reports, for example `more/functions/bufferData.html` and `glsl/misc/shader-with-non-reserved-words-*`. A browser hangs the same way. They time out until the APIs they call exist.
