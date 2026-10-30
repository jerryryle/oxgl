## ADDED Requirements

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
