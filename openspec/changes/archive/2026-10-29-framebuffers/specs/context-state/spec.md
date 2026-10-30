# Spec Delta

## ADDED Requirements

### Requirement: Framebuffer and renderbuffer bindings in getParameter
`getParameter` SHALL return the bound `WebGLFramebuffer`, or `null` for the drawing buffer, for `FRAMEBUFFER_BINDING` (WebGL 2: `DRAW_FRAMEBUFFER_BINDING`) and on WebGL 2 for `READ_FRAMEBUFFER_BINDING`, and the bound `WebGLRenderbuffer` or `null` for `RENDERBUFFER_BINDING` (WebGL 1.0 §5.14.3, WebGL 2.0 §3.7.2). While a framebuffer object is bound, `DRAW_BUFFERi`, `READ_BUFFER` and the implementation read format SHALL describe it.

#### Scenario: Bound objects
- **WHEN** framebuffer F and renderbuffer R are bound
- **THEN** `getParameter(FRAMEBUFFER_BINDING) === F` and `getParameter(RENDERBUFFER_BINDING) === R`

#### Scenario: Draw buffers of a framebuffer object
- **WHEN** a WebGL 2 framebuffer object is bound with its default draw buffers
- **THEN** `getParameter(DRAW_BUFFER0)` is `COLOR_ATTACHMENT0`
