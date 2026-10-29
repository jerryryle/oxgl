# Design

## Context

- `conformance/page.mjs` loads each page with `JSDOM.fromURL(url, { resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true })`, then installs a shim per window (`installShim`):
  - `HTMLCanvasElement.prototype.getContext` is replaced outright: WebGL types create oxgl contexts, every other type gets `null`;
  - `failMedia()` makes every `<img>`, `<video>` and `<audio>` fire `error` once a source is set.
- jsdom 30.1.3 declares `canvas@^3.2.3` as an optional peer dependency (`lib/jsdom/utils.js` `require("canvas")`). When the package is present, jsdom implements `getContext('2d')` and decodes images loaded through its resource loader. Measured on Linux arm64 (`linux/arm64` Docker, Node 24): `canvas@3.2.3` installs a prebuilt binary (MIT, Cairo and its libraries bundled, about 53 MB); an `<img>` loads a PNG and fires `load`; `drawImage` then `getImageData` returns the PNG's pixels. jsdom then still has no `ImageData` global and no `createImageBitmap`.
- jsdom's `window.postMessage(msg, '*')` to itself fires `message` with `event.source === null` (measured). The suite's `setZeroTimeout` (`js/webgl-test-utils.js`) ignores messages whose `source` is not the window, so `wtu.dispatchPromise` never settles.
- jsdom's `HTMLMediaElement.canPlayType` returns `""`, and `play()` logs "Not implemented" and returns `undefined`.

## Goals / Non-Goals

**Goals:** the runner gives pages the browser platform a WebGL test expects, wherever a test-only dependency can supply it, so a failing page means oxgl, not the runner, fell short.

**Non-Goals:** reading oxgl's drawing buffer from 2D APIs; video decoding; `ImageBitmap`. None of these ships in the oxgl package.

## Decisions

### node-canvas through jsdom, pinned as a devDependency

`canvas` is added to `devDependencies` at an exact version (`3.2.3`), matching how the repo pins its other devDependencies. jsdom finds it on its own, so the runner adds no 2D canvas or image code. npm doesn't install devDependencies for anyone who installs `oxgl`, so users never download it.

*Alternatives:*
- **`@napi-rs/canvas` (Skia)** is not a jsdom integration. The runner would have to implement `getContext('2d')`, image loading, `load`/`error` events and `drawImage` interop itself, which is more code than this whole change.
- **`optionalDependencies`** would let `npm ci` continue where the native install fails, but npm installs optional dependencies for every consumer of the package. Every `npm install oxgl` would then fetch about 53 MB of native code with Cairo that oxgl never uses.
- **Installing it only in the conformance CI job** keeps other jobs free of it, but splits the pinned version from `package-lock.json` and adds a setup step contributors must remember. The risk it avoids is a missing prebuilt, and prebuilts exist for Linux arm64 and macOS arm64 today (see Risks).

### The shim delegates `'2d'` and keeps one context type per canvas

`getContext` keeps jsdom's original method. For a WebGL type it creates or returns the oxgl context, as today. For any other type it returns `null` if the canvas already has an oxgl context; otherwise it calls jsdom's original, which returns the 2D context for `'2d'` and `null` for anything else. jsdom doesn't know about oxgl's contexts, so it can't enforce one type per canvas in the other direction. The shim therefore also records, in a `WeakSet`, canvases that returned a 2D context, and gives them `null` for WebGL types.

### Images are no longer failed

`failMedia()` narrows to `HTMLMediaElement` (`<video>`, `<audio>`). Images go through jsdom's resource loader to the suite server, which already serves the suite files (`conformance/server.mjs`). The `DOMContentLoaded` sweep and the `MutationObserver` for parser- and `innerHTML`-inserted elements stay, limited to media elements.

### Video and audio behave like a browser without codecs

`HTMLMediaElement.prototype.canPlayType` already returns `""`. The shim makes `play()` return a promise rejected with `new window.DOMException('…', 'NotSupportedError')`, as the HTML standard's play algorithm does for an unsupported source, instead of jsdom's `undefined`. The existing `error` dispatch after a source is set stays. Pages that skip unplayable types (`loadVideo` in `js/tests/tex-image-and-sub-image-2d-with-video.js`) then finish, and those that try to play see the rejection.

### `postMessage` delivers with a source

The shim replaces each window's `postMessage` (page and frames alike) with one that applies jsdom's `targetOrigin` check (`'*'`, `'/'` or the window's own origin), then dispatches `new window.MessageEvent('message', { data, origin, source })` on the target window in a task (`setTimeout(…, 0)`). jsdom's original is not also called, so each message arrives once.

- **`source` is the target window.** A call carries no record of which window's script made it, so the shim can't tell a self-post from a frame posting to its parent. It sets the one value that is right for self-posts. In the suite, `setZeroTimeout` in `js/webgl-test-utils.js` is the only code that reads `event.source`, and it does so for self-posts; the only cross-frame listener (`conformance/context/context-release-upon-reload.html`) reads `event.data` only. A frame posting to its parent therefore gets the parent as `source` rather than the frame. jsdom's own `null` is equally wrong there, and no page notices either.
- **`data` is passed unchanged, as jsdom already does** (measured: the listener receives the posted object itself), rather than structured-cloned. A clone made in the runner would create objects from the runner's realm, and jsdom windows have no `structuredClone` of their own. Every message the suite posts to a window is a string, for which a clone and the original can't be told apart.

*Alternative:* identifying the posting window from the caller's script URL in a stack trace. That would be fragile, and nothing in the suite would use the extra accuracy.

### `ImageData` from node-canvas

The shim sets `window.ImageData` to the `canvas` package's `ImageData`, the class that jsdom's 2D context returns from `createImageData` and `getImageData`, so `instanceof` holds. It has to be that class: node-canvas's `putImageData` accepts only its own `ImageData`. Instances and their `data` arrays therefore come from the runner's realm, not the page's, so a page check like `data instanceof Uint8ClampedArray` against the page's own constructor would be `false`. No page in the suite makes such a check. The one `instanceof ImageData` check (`conformance/more/conformance/argGenerators-S_V.js`) uses this global and holds. The textures change, which reads `ImageData` sources, checks them by shape (`width`, `height`, `data` as an `ArrayBufferView`), not by realm.

### The runner checks for `canvas` at startup

`conformance/run.mjs` resolves `canvas` before starting the suite server. If it is missing or its native binary fails to load, the run stops with an error naming the package and `npm ci`, and records no outcomes. A run without it would quietly turn about 200 pages into runner artifacts again.

## Risks / Trade-offs

- [The prebuilt `canvas` binary is unavailable for a platform, or its download fails, so `npm ci` falls back to compiling against system Cairo and fails, for every job on that platform] → On Linux arm64 and macOS arm64 the prebuilt installs (measured on Linux arm64). When the other platforms come back after the Linux arm64 focus, each port change checks that `npm ci` installs it, and moves the install into the conformance job if a platform has no prebuilt.
- [`npm ci` grows by about 53 MB and a native download] → It is test-only and cached with the other npm dependencies in CI.
- [Pages now get further and reach oxgl calls that don't exist yet] → Their failures become real API failures with accurate reasons. Expectations are regenerated, and task 3.2 records the pages that changed outcome.
- [A WebGL canvas drawn into a 2D context reads as blank] → Out of scope (proposal). Pages that check those pixels fail with a pixel mismatch, which the textures change addresses.

## Migration Plan

Developers run `npm ci` once to get `canvas`. The startup check tells anyone who hasn't.
