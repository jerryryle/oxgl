# Spec Delta

## MODIFIED Requirements

### Requirement: Pages obtain oxgl contexts through canvas
Within a page, `getContext` on a canvas element SHALL return an oxgl context for `'webgl'` and `'experimental-webgl'` (WebGL 1) and for `'webgl2'` (WebGL 2), sized to the canvas's `width` and `height` when it is first created, and a working 2D context for `'2d'`. It SHALL return the same context on later calls for that canvas, and `null` for any other context type or for a type other than the canvas's first one (HTML §4.12.5, `getContext`). The page's global scope SHALL expose oxgl's `WebGLRenderingContext` and `WebGL2RenderingContext`.

#### Scenario: Default canvas size
- **WHEN** a page calls `getContext('webgl')` on a canvas with no size attributes
- **THEN** it receives an oxgl `WebGLRenderingContext` with a 300×150 drawing buffer (cf. Khronos `conformance/canvas/drawingbuffer-test.html`)

#### Scenario: Unsupported context type
- **WHEN** a page calls `getContext('bitmaprenderer')`
- **THEN** it receives `null`, and a page that needs that context fails rather than the runner crashing

#### Scenario: 2D context
- **WHEN** a page calls `getContext('2d')`, fills a rectangle red, and reads it with `getImageData`
- **THEN** it receives a 2D context and reads back `[255, 0, 0, 255]`

#### Scenario: One context type per canvas
- **WHEN** a page calls `getContext('2d')` on a canvas, then `getContext('webgl')` on it, and does the same in the other order on a second canvas
- **THEN** both second calls return `null`

### Requirement: Unsupported media fails promptly
Video and audio elements in a page SHALL report no playable type (`canPlayType` returns `""`), SHALL reject `play()` with a `NotSupportedError` `DOMException`, and SHALL report a load error shortly after a source is set, instead of never loading, as a browser without codecs does. The runner SHALL NOT add or change any member of an oxgl context object; pages see oxgl's API as shipped.

#### Scenario: Texture upload from an image
- **WHEN** a page sets an `<img>` source and waits for its load event before uploading a texture
- **THEN** the image is not failed by this requirement: it loads as "Images load and decode" requires, and the page reaches its `texImage2D` call

#### Scenario: Texture upload from a video
- **WHEN** a page sets a `<video>` source and waits for it to load or play before uploading a texture
- **THEN** the video fires `error` or `play()` rejects, and the page fails or reports its own failure well before the time limit (cf. Khronos `conformance/textures/video/tex-2d-rgba-rgba-unsigned_byte.html`)

#### Scenario: Member oxgl lacks
- **WHEN** a page reads `gl.canvas` and oxgl does not provide it
- **THEN** the page sees `undefined`, as it would from oxgl outside the runner

## ADDED Requirements

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
