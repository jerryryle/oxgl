## ADDED Requirements

### Requirement: Compositing clears the drawing buffer
A host that composites a canvas (the conformance runner) SHALL be able to present a context's drawing buffer. Without `preserveDrawingBuffer`, presenting SHALL clear color, depth and stencil to their defaults (WebGL 1.0 §2.2) and leave every piece of context state unchanged, indexed color masks and framebuffer bindings included. It SHALL NOT be part of the public API; headless contexts are never composited.

#### Scenario: Presented without preserveDrawingBuffer
- **WHEN** a context with a red-cleared drawing buffer, a scissor test enabled and a framebuffer object bound is presented
- **THEN** the drawing buffer reads transparent black, the scissor test is still enabled and the framebuffer object is still bound (cf. Khronos `conformance/canvas/buffer-preserve-test.html`)

#### Scenario: Presented with preserveDrawingBuffer
- **WHEN** a context created with `preserveDrawingBuffer: true` is presented
- **THEN** its drawing buffer keeps its contents (cf. Khronos `conformance/context/context-attribute-preserve-drawing-buffer.html`)

#### Scenario: Indexed color masks survive
- **WHEN** a WebGL 2 context with `OES_draw_buffers_indexed` has different color masks on draw buffers 0 and 1 and is presented
- **THEN** `getIndexedParameter(COLOR_WRITEMASK, i)` returns each buffer's own mask (cf. Khronos `conformance2/extensions/oes-draw-buffers-indexed.html`)
