# Design

## Context

- `drawing-buffer` renders into an internal framebuffer object (`DrawingBuffer::framebuffer()`), multisampled when antialiased, with `begin_read`/`end_read` resolving it for reads. It answers `DRAW_BUFFERi`, `READ_BUFFER` and the implementation read format itself because ANGLE describes the FBO, not a default framebuffer.
- To build the drawing buffer, WebGL 1 contexts request `GL_OES_rgb8_rgba8`, `GL_ANGLE_framebuffer_multisample` and `GL_ANGLE_framebuffer_blit` from ANGLE. Those widen what ANGLE accepts on WebGL 1 (`RGBA8` renderbuffers, `READ_FRAMEBUFFER`/`DRAW_FRAMEBUFFER`), which WebGL 1 itself does not allow.
- The object model, binding bookkeeping in TS, and deferred deletion come from `core-rendering`; textures from `textures`.

## Decisions

### `null` is the drawing buffer

`bindFramebuffer(target, null)` binds `DrawingBuffer::framebuffer()`. The TS layer mirrors the draw and read bindings (`null` for the drawing buffer), so `getParameter(FRAMEBUFFER_BINDING)` and friends return the bound object. ANGLE reverts a deleted bound framebuffer to name 0, which here has no surface, so `deleteFramebuffer` rebinds the drawing buffer's framebuffer for every target the deleted one was bound to.

`DrawingBuffer::parameter` (`DRAW_BUFFERi`, `READ_BUFFER`, implementation read format) answers only while the drawing buffer is bound for the query's target; otherwise ANGLE answers for the bound framebuffer object. The drawing buffer's own draw and read buffer state (WebGL 2: `BACK` or `NONE`) is stored in `DrawingBuffer` and changed by `drawBuffers`/`readBuffer` while it is bound: `BACK` maps to `COLOR_ATTACHMENT0` on the FBO, `NONE` to `NONE`, and any other value generates `INVALID_OPERATION` (OpenGL ES 3.0 §4.2.1, §4.3.1).

`checkFramebufferStatus` for the drawing buffer returns `FRAMEBUFFER_COMPLETE`. `getFramebufferAttachmentParameter` on WebGL 2 with the drawing buffer bound accepts `BACK`, `DEPTH` and `STENCIL` and answers from the allocated attributes (OpenGL ES 3.0 §6.1.13); on WebGL 1 it generates `INVALID_OPERATION`, as ES 2.0 does for framebuffer 0.

### WebGL 1's lists, not ANGLE's

On WebGL 1, `oxgl-core` checks against WebGL's own lists before forwarding (WebGL 1.0 §5.14.6–§5.14.7, §6.6): the only framebuffer target is `FRAMEBUFFER`, renderbuffer formats are `RGBA4`, `RGB565`, `RGB5_A1`, `DEPTH_COMPONENT16`, `STENCIL_INDEX8` and `DEPTH_STENCIL` (mapped to `DEPTH24_STENCIL8`), and attachments are `COLOR_ATTACHMENT0`, `DEPTH_ATTACHMENT`, `STENCIL_ATTACHMENT` and `DEPTH_STENCIL_ATTACHMENT`. Anything else generates `INVALID_ENUM`. Extensions that add formats or attachments extend these lists. WebGL 2 forwards to ANGLE, whose ES 3.0 validation is WebGL 2's.

### Attachments and lifetime

The TS layer records each framebuffer object's attachments (texture or renderbuffer per attachment point, with `DEPTH_STENCIL_ATTACHMENT` recorded on both depth and stencil), which keeps attached objects reachable and answers `FRAMEBUFFER_ATTACHMENT_OBJECT_NAME`. `deleteTexture` and `deleteRenderbuffer` detach the object from the bound draw and read framebuffers, as GL does (OpenGL ES 3.0 §4.4.2.4). An attachment call returns whether GL accepted it (the native call compares `FRAMEBUFFER_ATTACHMENT_OBJECT_NAME` afterwards), so the bookkeeping never diverges from GL.

### Reads and blits from the antialiased drawing buffer

`readPixels`, `copyTex*` and `blitFramebuffer` with the drawing buffer as read framebuffer resolve first, through the existing `begin_read`/`end_read`. `readPixels` reads whatever framebuffer is bound for reading; with a framebuffer object it is a plain read.

### Pixel pack buffer reads

The `GLintptr offset` overload of `readPixels` requires a pixel pack buffer bound, and the view overload requires none (WebGL 2.0 §3.7.10); either mismatch generates `INVALID_OPERATION` before GL is called. The offset form calls `glReadPixels` with the offset, which ANGLE validates against the buffer and never dereferences.

### Safety rules

- **Unsafe confinement:** new entry points are `Current` methods in `oxgl-sys`; `invalidateFramebuffer`, `drawBuffers` and `clearBuffer*` take Rust slices with their lengths; queries use robust getters.
- **No panics:** attachment lists and enum mapping are total; unknown values become WebGL errors.
- **Handle model:** framebuffers and renderbuffers are slotmap objects; the internal drawing-buffer names never reach JS.
- **ArrayBuffer lifetime:** `clearBuffer*` and `readPixels` read and write views only for the call.

## Risks / Trade-offs

- [Bookkeeping of attachments diverging from GL] → Attachment calls report GL's result; deletion follows GL's detach rules for the bound framebuffers only, as GL does.
