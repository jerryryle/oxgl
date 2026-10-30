## ADDED Requirements

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
