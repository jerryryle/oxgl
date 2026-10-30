# Spec Delta

## ADDED Requirements

### Requirement: WebGL canvases in the runner's DOM
In the conformance runner, drawing a canvas that has an oxgl context into a 2D canvas, or calling its `toDataURL`, SHALL use the context's drawing buffer, unpremultiplied, top row first; `HTMLImageElement.decode()` SHALL resolve once the image has loaded and reject when it fails to.

#### Scenario: WebGL canvas drawn into a 2D canvas
- **WHEN** a page clears a WebGL canvas to a color and draws it into a 2D canvas
- **THEN** the 2D canvas reads back that color (cf. Khronos `conformance/canvas/draw-webgl-to-canvas-test.html`)
