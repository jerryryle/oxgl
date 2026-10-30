# conformance-testing Specification

## Purpose
Measures oxgl against the Khronos WebGL 1 and WebGL 2 conformance suites under Node, and holds every change to a checked-in record of which conformance pages are expected to pass.

## Requirements

### Requirement: Pinned conformance suite
The repository SHALL pin one commit of the Khronos WebGL repository (`KhronosGroup/WebGL`) whose `sdk/tests` tree is the suite under test. A run SHALL use only that commit's files, obtained by commit hash. The suite SHALL NOT be committed to the oxgl repository.

#### Scenario: Suite fetched by pinned commit
- **WHEN** a developer runs the conformance command on a clean checkout
- **THEN** it obtains `sdk/tests` at the pinned commit, reuses that copy on later runs, and fetches again only when the pin changes

#### Scenario: Pin changed
- **WHEN** a change updates the pinned commit
- **THEN** the next run uses the new commit's tests, and any resulting differences from the expectations fail the run until the expectations are updated in the same change

### Requirement: WebGL 1 and WebGL 2 suites
The runner SHALL provide two suites, each selected by the suite's own test lists and version filters (`sdk/tests/00_test_list.txt`, `--min-version`/`--max-version`). The `webgl1` suite SHALL run the 1.0.x list with WebGL 1 contexts. The `webgl2` suite SHALL run the 2.0.x list, which includes `conformance/`, with WebGL 2 contexts, as the Khronos harness does for a WebGL 2 run.

#### Scenario: conformance page in both suites
- **WHEN** both suites run
- **THEN** a page under `conformance/` that the version filters admit is run twice, once with WebGL 1 contexts and once with WebGL 2 contexts, and is judged separately in each suite

#### Scenario: conformance2 page only in webgl2
- **WHEN** the `webgl1` suite runs
- **THEN** no page under `conformance2/` is run

### Requirement: Pages obtain oxgl contexts through canvas
In a page, `getContext` on a canvas SHALL return an oxgl context for `'webgl'` and `'experimental-webgl'` (WebGL 1) and `'webgl2'` (WebGL 2), created with the canvas's size, the `getContext` attributes and the element as its `canvas`, and a working 2D context for `'2d'`. Later calls SHALL return the same context, and `null` for other types. The page's global scope SHALL expose oxgl's `WebGLRenderingContext` and `WebGL2RenderingContext`.

#### Scenario: Default canvas size
- **WHEN** a page calls `getContext('webgl')` on a canvas with no size attributes
- **THEN** it receives an oxgl `WebGLRenderingContext` with a 300×150 drawing buffer (cf. Khronos `conformance/canvas/drawingbuffer-test.html`)

#### Scenario: Context belongs to its canvas
- **WHEN** a page calls `canvas.getContext('webgl', { alpha: false })`
- **THEN** `gl.canvas === canvas` and `gl.getContextAttributes().alpha` is `false`

#### Scenario: Unsupported context type
- **WHEN** a page calls `getContext('bitmaprenderer')`
- **THEN** it receives `null`, and a page that needs that context fails rather than the runner crashing

#### Scenario: 2D context
- **WHEN** a page calls `getContext('2d')`, fills a rectangle red, and reads it with `getImageData`
- **THEN** it receives a 2D context and reads back `[255, 0, 0, 255]`

### Requirement: One context type per canvas
A canvas that returned a context of one type SHALL return `null` from `getContext` for any other type, in both directions between oxgl's WebGL contexts and the 2D context (HTML §4.12.5, `getContext`).

#### Scenario: One context type per canvas
- **WHEN** a page calls `getContext('2d')` on a canvas, then `getContext('webgl')` on it, and does the same in the other order on a second canvas
- **THEN** both second calls return `null`

### Requirement: oxgl objects belong to the page
As in a browser, oxgl's context classes, the contexts a page creates and the errors oxgl's API throws SHALL belong to the page's own JavaScript realm.

#### Scenario: Errors are the page's own types
- **WHEN** a page calls a context method with an argument WebIDL rejects and checks the exception with `instanceof TypeError` (as `wtu.shouldThrow` does)
- **THEN** the check succeeds, and the classes' prototype chains end at the page's own `Object.prototype` (cf. Khronos `conformance/context/context-type-test.html`)

### Requirement: Rejected context creation returns null
When oxgl rejects a context creation requested through `getContext`, `getContext` SHALL return `null`, as a browser does when creation fails, and the rejection message SHALL be recorded with the page's results.

#### Scenario: Creation rejected by oxgl
- **WHEN** a page running on the software backend calls `getContext('webgl', { failIfMajorPerformanceCaveat: true })` and oxgl's `createContext` throws
- **THEN** `getContext` returns `null` instead of throwing, and the report's entry for the page includes oxgl's error message

### Requirement: Closure-loaded scripts run in browser order
When a page loads scripts through the Closure Library's uncompiled loader (`goog.require` in `closure-library/closure/goog/base.js`, as every `deqp/` page does), each file the loader imports SHALL run before the import returns, dependencies first, as a script written with `document.write` during parsing runs in a browser (HTML Standard §8.4.3).

#### Scenario: deqp namespace defined before the page uses it
- **WHEN** a page calls `goog.require('functional.gles3.es3fAttribLocationTests')` from a `<head>` script and calls that namespace's `run` from a later `<body>` script (Khronos `deqp/functional/gles3/attriblocation.html`)
- **THEN** the `<body>` script finds the namespace defined and the page goes on to create its context, instead of throwing `ReferenceError: functional is not defined`

### Requirement: Closure-loaded scripts fail on their own
An uncaught error in a file the Closure loader imports SHALL be recorded as the page's escaped error (Escaped script errors) and SHALL NOT stop the remaining imports. A file the loader names that is missing, outside the suite root or on another origin SHALL NOT be run.

#### Scenario: Error in an imported file
- **WHEN** one file the loader imports throws at its top level and the page expects to pass
- **THEN** that error is recorded as the page's escaped error with the imported file named in it, the files imported after it still run, and the page is judged as any page with an escaped error is

#### Scenario: Imported file missing
- **WHEN** the dependency table names a file that does not exist under the suite root, or one on another origin
- **THEN** the file is not run, the namespaces it would provide stay undefined, and the page fails from its own scripts rather than with a harness error

### Requirement: Page outcome
Each page run SHALL have exactly one outcome, taken from the first rule that applies. `CRASH`: its process dies from a signal or abort the runner did not send, even after the page reported, or does not exit 30 s after completing. `FAIL`: a script error escapes in a page that ends early on errors. `TIMEOUT`: it goes the time limit without a new result. `FAIL`: it completes with a failing result or no results. `PASS`: it completes with at least one result, all succeeding.

#### Scenario: Uncaught exception in a page expected to fail
- **WHEN** a page whose expectation is `FAIL` calls a WebGL method oxgl does not implement and the resulting `TypeError` is not caught by the page
- **THEN** the page's outcome is `FAIL`, the exception message is recorded, and the page ends at once rather than waiting out the time limit

#### Scenario: Uncaught exception in a page expected to pass
- **WHEN** a page with no expectations entry throws an uncaught error and then never completes
- **THEN** the page keeps running until the time limit, its outcome is `TIMEOUT`, and the error message is recorded

#### Scenario: Page recovers from an uncaught exception
- **WHEN** a page with no expectations entry throws an uncaught error from a callback and its main script then completes with only passing results
- **THEN** the page's outcome is `PASS`, as in the official harness

#### Scenario: Every page ends early on errors
- **WHEN** a run asks for every page to end early on errors and a page with no expectations entry throws an uncaught error
- **THEN** the page's outcome is `FAIL` and it ends at once

#### Scenario: Page never finishes
- **WHEN** a page waits on a promise that never settles and so never signals completion
- **THEN** its outcome is `TIMEOUT` after the time limit and the run continues with the next page

#### Scenario: Crash after reporting
- **WHEN** a page reports only passing results and completes, and the process then aborts while destroying its contexts
- **THEN** the page's outcome is `CRASH`

#### Scenario: Hang while tearing down
- **WHEN** a page completes with only passing results and its process then hangs while destroying its contexts
- **THEN** the runner kills the process 30 seconds later and the page's outcome is `CRASH`, not `TIMEOUT` or `PASS`

#### Scenario: Long page that keeps reporting
- **WHEN** a page reports results steadily and takes longer in total than the time limit, never going the time limit without a new result
- **THEN** it is not timed out, and its outcome follows from its results

#### Scenario: Runner stops a hung page
- **WHEN** the runner kills a page's process at the time limit
- **THEN** the page's outcome is `TIMEOUT`, not `CRASH`

### Requirement: Escaped script errors
A page SHALL end early on errors when its expectation is `FAIL` or when the run asks for every page to end early on errors: it ends at the first escaped script error. Every other page SHALL treat an escaped script error as the official harness (`webgl-test-harness.js`) does: the error is recorded and the page keeps running until it completes or reaches the time limit. The first escaped error's message SHALL be recorded for every page that has one.

#### Scenario: Empty expectations
- **WHEN** the expectations file has no entries and the run does not ask for every page to end early on errors
- **THEN** every page is judged as the official harness judges it

### Requirement: Runner errors are not page outcomes
When the runner's own code fails for a page (for example while setting up the page's window or loading it from the runner's server), the run SHALL fail with a harness error naming the page and the error. The other pages SHALL still run and be judged, and the report SHALL still be written. A harness error SHALL NOT be recorded as a page outcome, and the update option SHALL NOT write it to the expectations.

#### Scenario: Page setup fails
- **WHEN** the runner throws while preparing a page, before any page script runs
- **THEN** the run fails reporting a harness error for that page, the page is not recorded as `CRASH` or `FAIL`, and every other page runs and appears in the report

### Requirement: Pages are isolated
Each page SHALL run in its own process with fresh global state. A crash, hang or leaked resource in one page SHALL NOT change another page's outcome or stop the run.

#### Scenario: Native crash in one page
- **WHEN** a page makes the Node process running it abort
- **THEN** that page's outcome is `CRASH`, and every other page runs and is judged normally

### Requirement: Checked-in expectations
The repository SHALL contain an expectations file listing every page, per suite, whose expected outcome is not `PASS`. Each entry SHALL give the suite, the page path relative to `sdk/tests`, one of `FAIL`, `TIMEOUT`, `CRASH` or `SKIP`, and a non-empty reason. A page absent from the file is expected to `PASS`. A `SKIP` page SHALL NOT be run unless the developer asks for skipped pages to be included. When included, its outcome SHALL be reported but not judged.

#### Scenario: Entry without a reason
- **WHEN** the expectations file contains an entry with no reason
- **THEN** the conformance command fails before running any page and names the entry

#### Scenario: Skipped page
- **WHEN** a page is listed as `SKIP` and the developer does not ask to include skipped pages
- **THEN** the page is not run and is reported as skipped

#### Scenario: Skipped pages included
- **WHEN** the developer includes skipped pages and a `SKIP` page times out again or now passes
- **THEN** the report shows its outcome, and the run's success is unaffected by it

### Requirement: Runs are judged against expectations
A run SHALL succeed only when every non-`SKIP` page it ran had its expected outcome. It SHALL fail and name each page that regressed (expected `PASS`, got another outcome), passed unexpectedly, or had a different non-`PASS` outcome than expected. A run of whole suites SHALL also fail when an entry for one of those suites names a page that the suite does not contain.

#### Scenario: Regression
- **WHEN** a change makes a page that was passing fail
- **THEN** the run fails and lists the page with its expected and actual outcomes

#### Scenario: Unexpected pass
- **WHEN** a change makes a page listed as `FAIL` pass
- **THEN** the run fails and names the page, so its entry is removed in the same change

#### Scenario: Stale entry
- **WHEN** the expectations file lists a page that the pinned suite no longer contains
- **THEN** the run fails and names the entry

#### Scenario: Single-suite run
- **WHEN** the developer runs only the `webgl1` suite
- **THEN** entries for `webgl2` are neither judged nor reported stale

### Requirement: Results report
Every run SHALL write a machine-readable report recording, per suite and page, the outcome, the counts of passing and failing results, the duration, and the first failure message or error. The report SHALL also record the suite commit, the requested oxgl backend, the per-page time limit, the number of pages run in parallel, platform and timestamp.

#### Scenario: Report after a failed run
- **WHEN** a run fails because of a regression
- **THEN** the report is still written and contains the regressed page's failure message

### Requirement: Conformance command
The root `package.json` SHALL expose `npm run conformance`, which runs both suites against the built package and exits non-zero when the run fails. It SHALL accept options to select one suite, to restrict the run to pages whose path contains a given substring, to include `SKIP` pages, to make every page end early on errors (Page outcome), and to rewrite the expectations file from the run's outcomes. A filtered run SHALL judge only the pages it ran.

#### Scenario: Filtered run
- **WHEN** a developer runs the command restricted to `conformance/buffers/`
- **THEN** only pages under that directory run, and expectations for other pages are neither checked nor reported stale

#### Scenario: Updating expectations
- **WHEN** a developer runs the command with the update option
- **THEN** the run is judged against the expectations it writes, the expectations entries for the pages that ran are replaced with their outcomes, existing reasons are kept for entries whose outcome is unchanged, entries for pages that now pass are removed, on a run of whole suites entries for pages those suites no longer contain are removed, and new or changed entries take the page's first escaped error as their reason, or its first failure message when it has none (for `TIMEOUT` and `CRASH`, `no new result within the time limit` / `crashed`, followed by the first escaped error's message when there is one), reduced to its first line and at most 200 characters; the command then exits zero unless the expectations file could not be parsed or a page had a harness error

### Requirement: Pages run in parallel
The conformance command SHALL accept an option setting how many pages run at once, defaulting to the number of CPUs available to the process, but no more than one page per GiB of memory available to it (at least one).

#### Scenario: Default parallelism
- **WHEN** a developer runs the command without the parallelism option on a machine where 4 CPUs are available to the process
- **THEN** up to 4 pages run at once, and the report records 4 as the number of pages run in parallel

#### Scenario: Memory bounds the default
- **WHEN** a developer runs the command without the parallelism option on a machine with 16 CPUs and 8 GiB of memory
- **THEN** up to 8 pages run at once, so pages do not stall while the machine swaps

### Requirement: Backend follows the environment
The runner SHALL create contexts with the backend selected by `OXGL_BACKEND` (backend-selection), and the report SHALL record that requested backend (`auto` when unset). Under `auto` the report does not say which backend served each context; runs meant to be compared set `OXGL_BACKEND` explicitly.

#### Scenario: Software run
- **WHEN** the command runs with `OXGL_BACKEND=software`
- **THEN** every context the pages create renders with SwiftShader and the report records `software`

### Requirement: Images load and decode
Image elements in a page SHALL load their source from the suite, fire `load` with their natural size, and be drawable into a 2D context, which then reads back their decoded pixels. An image whose source cannot be loaded or decoded SHALL fire `error`.

#### Scenario: Image drawn into a 2D canvas
- **WHEN** a page loads a suite PNG into an `<img>`, waits for `load`, draws it into a 2D canvas and calls `getImageData`
- **THEN** the pixels match the PNG's (cf. Khronos `conformance/textures/image/tex-2d-rgba-rgba-unsigned_byte.html`)

#### Scenario: Missing image
- **WHEN** a page sets an `<img>` source to a path the suite does not have
- **THEN** the image fires `error`

### Requirement: Messages carry their source
A message posted with `window.postMessage` SHALL be delivered once, in a task, as a `message` event whose `source` is the receiving window, when the `targetOrigin` is `'*'`, `'/'` or the receiving window's origin. Its `data` SHALL be the posted value itself, as jsdom delivers it.

Accepted trade-off (HTML §9.3.3 differs): a frame posting to its parent gets the parent as `source`, and objects are not cloned. The suite reads `source` only for self-posts and posts only strings.

#### Scenario: Zero-timeout helper
- **WHEN** a page queues a callback with a helper that, like the suite's `setZeroTimeout` in `js/webgl-test-utils.js`, posts a message to its own window and runs the callback only when `event.source == window`
- **THEN** the callback runs (cf. Khronos `conformance/context/context-creation.html`)

#### Scenario: Message from a frame
- **WHEN** a frame calls `parent.postMessage('Ready', '*')`
- **THEN** the page's `message` listener receives `'Ready'` exactly once (cf. Khronos `conformance/context/context-release-upon-reload.html`)

#### Scenario: Mismatched target origin
- **WHEN** a page posts to its own window with a `targetOrigin` of another origin
- **THEN** no `message` event is delivered

### Requirement: ImageData in pages
The page's global scope SHALL expose a working `ImageData` constructor, and the 2D context's `createImageData` and `getImageData` SHALL return instances of it.

Accepted trade-off: the constructor is the canvas package's, which its `putImageData` requires, so instances and their `data` belong to the runner's realm, not the page's.

#### Scenario: Constructed ImageData
- **WHEN** a page evaluates `new ImageData(2, 1)`
- **THEN** it receives an object with `width` `2`, `height` `1`, and a 8-byte `Uint8ClampedArray` `data` of zeros, and `ctx.getImageData(0, 0, 1, 1) instanceof ImageData` is `true`

### Requirement: The runner requires the canvas package
The runner SHALL refuse to run pages when the `canvas` package cannot be loaded, reporting a runner error that names the package and how to install it, instead of running pages without 2D canvases or images.

#### Scenario: Canvas package missing
- **WHEN** `npm run conformance` runs and `require('canvas')` fails
- **THEN** the run stops before any page with an error naming `canvas` and `npm ci`, and no page outcome is recorded

### Requirement: Canvas resizes reach the drawing buffer
When a page changes the `width` or `height` of a canvas that has an oxgl context, through the property or the content attribute, the context's drawing buffer SHALL be resized to the canvas's new size before that call returns, as a browser does (WebGL 1.0 §2.2).

#### Scenario: Page resizes its canvas
- **WHEN** a page sets `canvas.width = 20` on a canvas with a WebGL context
- **THEN** `gl.drawingBufferWidth` is `20` (cf. Khronos `conformance/canvas/drawingbuffer-test.html`)

#### Scenario: Page resizes through the attribute
- **WHEN** a page calls `canvas.setAttribute('height', '30')` and then `canvas.removeAttribute('width')` on a canvas with a WebGL context
- **THEN** `gl.drawingBufferHeight` is `30` right after the first call, and `gl.drawingBufferWidth` is `300` right after the second

### Requirement: WebGL canvases in the runner's DOM
In the conformance runner, drawing a canvas that has an oxgl context into a 2D canvas, or calling its `toDataURL`, SHALL use the context's drawing buffer, unpremultiplied, top row first; `HTMLImageElement.decode()` SHALL resolve once the image has loaded and reject when it fails to.

#### Scenario: WebGL canvas drawn into a 2D canvas
- **WHEN** a page clears a WebGL canvas to a color and draws it into a 2D canvas
- **THEN** the 2D canvas reads back that color (cf. Khronos `conformance/canvas/draw-webgl-to-canvas-test.html`)

### Requirement: Canvases are composited each frame
At the start of each animation frame, before that frame's callbacks, the runner SHALL present the drawing buffer of every WebGL canvas in the document, as a browser composites it. Canvases outside the document SHALL NOT be presented.

#### Scenario: On-screen and off-screen canvases
- **WHEN** a page clears an on-screen and an off-screen canvas to red and waits for a composite
- **THEN** the on-screen canvas reads transparent black and the off-screen one still reads red (cf. Khronos `conformance/canvas/buffer-offscreen-test.html`)

### Requirement: Long-running pages load later resources
The runner's server SHALL keep a page's idle connections open however long the page runs synchronously, so a resource requested afterwards (such as `js-test-post.js`) loads instead of failing on a connection the server closed.

#### Scenario: Page busy for longer than five seconds
- **WHEN** a page runs synchronously for more than five seconds and then calls `finishTest()`
- **THEN** the page completes instead of timing out (cf. Khronos `conformance/reading/read-pixels-test.html`)

### Requirement: Tainted 2D canvases in the runner
In the runner's DOM, a 2D canvas that draws a cross-origin image without CORS, or a tainted canvas, SHALL become tainted, and its `getImageData` and `toDataURL` SHALL throw a `SecurityError` (HTML §4.12.5.1.7). The suite's cross-origin images come from its server under the other loopback name (`127.0.0.1` or `localhost`).

#### Scenario: Canvas drawn with a cross-origin image
- **WHEN** a page draws a cross-origin image into a 2D canvas and uploads the canvas with `texImage2D`
- **THEN** a `SecurityError` is thrown (cf. Khronos `conformance/more/functions/texImage2DHTML.html`)

### Requirement: Workers in pages
The runner SHALL provide `Worker` for classic scripts, run on worker threads, with `postMessage` in both directions, `onmessage` and `message` listeners, `close` and `terminate`. Messages reaching the page SHALL be structured clones rebuilt in the page's realm. Workers SHALL have no `importScripts`, WebGL or `OffscreenCanvas`.

#### Scenario: Page with a worker
- **WHEN** a page creates a `Worker` whose script posts a message and closes
- **THEN** the page receives the message, and its WebGL contexts are released across reloads as without the worker (cf. Khronos `conformance/context/context-release-with-workers.html`)

#### Scenario: Typed arrays through a worker
- **WHEN** a page sends typed arrays to a worker and receives them back
- **THEN** they arrive with their contents, as instances of the page's own constructors (cf. Khronos `conformance/typedarrays/typed-arrays-in-workers.html`)

### Requirement: Window load fires once
The runner SHALL deliver a window's `load` event to the page once, as browsers do, even when jsdom fires it again after later image loads.

#### Scenario: Images created after load
- **WHEN** a page's `<body onload>` handler creates images, and they finish loading
- **THEN** the handler has run once (cf. Khronos `conformance/textures/misc/tex-image-with-format-and-type.html`)

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

### Requirement: OffscreenCanvas in pages and workers
The runner SHALL provide `OffscreenCanvas` in pages and workers, with oxgl WebGL contexts, 2D contexts, `transferToImageBitmap` (which leaves a cleared drawing buffer), `convertToBlob`, and `HTMLCanvasElement.transferControlToOffscreen`, whose canvas is composited when its placeholder is in the document.

#### Scenario: WebGL on an OffscreenCanvas in a worker
- **WHEN** a worker creates a WebGL context on an OffscreenCanvas and checks its creation
- **THEN** the page receives the worker's result (cf. Khronos `conformance/offscreencanvas/context-creation-worker.html`)

#### Scenario: Transferred canvas without preserveDrawingBuffer
- **WHEN** a page draws to the OffscreenCanvas of a placeholder in the document and waits for frames
- **THEN** the drawing buffer is cleared (cf. Khronos `conformance/offscreencanvas/context-attribute-preserve-drawing-buffer.html`)

### Requirement: Worker globals
The runner's workers SHALL load oxgl in their thread and have the WebGL interfaces, `OffscreenCanvas`, `ImageBitmap`, `ImageData`, `requestAnimationFrame`, nested `Worker`s, Blob URLs, and `importScripts` of the suite's own files. ImageBitmaps SHALL cross threads as their pixels.

#### Scenario: ImageBitmap from a nested worker
- **WHEN** a worker starts a worker from a Blob URL, which transfers an ImageBitmap back
- **THEN** the page receives an ImageBitmap with the drawn pixels (cf. Khronos `conformance/offscreencanvas/offscreencanvas-transfer-image-bitmap.html`)

### Requirement: Video plays through ffmpeg
Video elements in a page SHALL load, play and report their size, duration and current time, decoded by ffmpeg with rotation applied. `canPlayType` SHALL answer "maybe" for video types, `play()` SHALL resolve once the video has loaded, and `requestVideoFrameCallback` SHALL call back on the next frame. A source that does not decode SHALL fire `error` and reject `play()` promptly.

#### Scenario: Video in a 2D canvas and an ImageBitmap
- **WHEN** a page draws a playing video into a 2D canvas, or creates an ImageBitmap from it
- **THEN** the current frame is drawn, or held (cf. Khronos `conformance/textures/image_bitmap_from_video/tex-2d-rgba-rgba-unsigned_byte.html`)

#### Scenario: Missing video
- **WHEN** a page sets a `<video>` source that does not exist and calls `play()`
- **THEN** `error` fires and `play()` rejects with `NotSupportedError` well before the time limit

#### Scenario: Texture upload from a video
- **WHEN** a page plays a red-above-green video and uploads it with `texImage2D`
- **THEN** the texture's top rows are red and its bottom rows green (cf. Khronos `conformance/textures/video/tex-2d-rgba-rgba-unsigned_byte.html`)

#### Scenario: Rotated video
- **WHEN** a page uploads a video with rotation metadata
- **THEN** the frame uploads upright (cf. Khronos `conformance/textures/misc/video-rotation.html`)

### Requirement: The runner requires ffmpeg
The runner SHALL refuse to run pages when `ffmpeg` or `ffprobe` cannot be run, reporting a runner error that names them, instead of running video pages that would skip their video cases.

#### Scenario: ffmpeg missing
- **WHEN** `npm run conformance` runs and `ffprobe -version` fails
- **THEN** the run stops before any page with an error naming ffmpeg, and no page outcome is recorded
