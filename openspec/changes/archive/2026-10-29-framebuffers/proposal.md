# Proposal

## Why

Render-to-texture, shadow maps, post-processing, picking and multisampled render targets all need framebuffer and renderbuffer objects, and so does every three.js `WebGLRenderTarget`. After `core-rendering` and `textures`, `createFramebuffer`/`createRenderbuffer` are the next missing calls in the conformance results, and WebGL 2's framebuffer functions (`blitFramebuffer`, `drawBuffers`, `readBuffer`, `clearBuffer*`, `invalidateFramebuffer`) follow.

## What Changes

- **Framebuffer and renderbuffer objects** (WebGL 1.0 §5.14.6–§5.14.7): `WebGLFramebuffer`, `WebGLRenderbuffer`, `create*`, `bind*`, `delete*`, `is*`, `framebufferTexture2D`, `framebufferRenderbuffer`, `renderbufferStorage`, `checkFramebufferStatus`, `getFramebufferAttachmentParameter`, `getRenderbufferParameter`, including WebGL's `DEPTH_STENCIL_ATTACHMENT` and `DEPTH_STENCIL` renderbuffer format.
- **The drawing buffer as framebuffer `null`**: binding `null` binds oxgl's drawing-buffer framebuffer, `getParameter`'s framebuffer bindings and default-framebuffer queries describe it as the default framebuffer, and deleting a bound framebuffer falls back to it.
- **WebGL 2 framebuffer functions** (WebGL 2.0 §3.7.4–§3.7.5, §3.7.9): `READ_FRAMEBUFFER`/`DRAW_FRAMEBUFFER` targets, `framebufferTextureLayer`, `blitFramebuffer` (from the resolved drawing buffer when antialiased), `drawBuffers` (with `BACK` mapped for the default framebuffer), `readBuffer`, `invalidateFramebuffer`, `invalidateSubFramebuffer`, `clearBufferfv/iv/uiv/fi`, `renderbufferStorageMultisample`, `getInternalformatParameter`.
- **`readPixels` into a pixel pack buffer** (WebGL 2.0 §3.7.10, the `GLintptr offset` overload), and `INVALID_OPERATION` for the view overload while one is bound.
- Conformance expectations are regenerated.

## Capabilities

### New Capabilities

- `framebuffers`: framebuffer and renderbuffer objects, attachments, completeness and queries, and WebGL 2's blit, draw/read buffers, invalidation and buffer clears (WebGL 1.0 §5.14.6–§5.14.7, WebGL 2.0 §3.7.4–§3.7.5).

### Modified Capabilities

- `context-state`: `getParameter` returns the bound framebuffer and renderbuffer objects (`FRAMEBUFFER_BINDING`, `RENDERBUFFER_BINDING`, WebGL 2's `READ_FRAMEBUFFER_BINDING`), and answers `DRAW_BUFFERi`, `READ_BUFFER` and the implementation read format from GL while a framebuffer object is bound.
- `pixel-readback`: `readPixels` reads from the bound read framebuffer, and on WebGL 2 into a pixel pack buffer.

## Impact

- `crates/oxgl-sys`: framebuffer, renderbuffer, blit, invalidation, clear-buffer and query entry points.
- `crates/oxgl-core`: `Framebuffer` and `Renderbuffer` objects, WebGL format and target lists for WebGL 1 (ANGLE accepts more because oxgl enables extensions internally), the default-framebuffer mapping.
- `crates/oxgl-node`, `src/`: exports, the object classes, binding and attachment bookkeeping.

## Out of Scope and Extension Points

- **`WEBGL_draw_buffers`, `EXT_color_buffer_float`, `EXT_color_buffer_half_float`, `WEBGL_depth_texture`** (`extensions` change): until then WebGL 1 has one color attachment, and float color formats are not renderable on WebGL 2.
- **Multiview and `WEBGL_multisampled_render_to_texture`.**
