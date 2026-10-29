# Proposal

## Why

The drawing buffer is an EGL pbuffer, so its format is whatever the backend's EGL configs offer, and that can't satisfy WebGL's context attributes. On Linux arm64, SwiftShader offers only RGBA8 pbuffer configs, so `alpha: false`, which WebGL requires to hold (WebGL 1.0 §5.2.1), cannot be met. Its only stencil config also carries 24-bit depth, so `depth: false, stencil: true` cannot be met either. A multisampled pbuffer would make the default framebuffer multisampled, and OpenGL ES 3.0 §3.8.5 then makes `copyTexImage2D` fail, which WebGL forbids.

Browsers solve this by rendering into a framebuffer object they control. Chromium does exactly that on ANGLE. Doing the same makes every attribute achievable with formats GLES guarantees, the same on every backend. It also brings `gl.canvas`, resizing and `getContextAttributes`, which about 460 conformance pages and three.js need.

## What Changes

- **The drawing buffer becomes a framebuffer object** on a surfaceless EGL context. Its attachments are renderbuffers chosen from the context attributes:
  - color: RGBA8, or RGB8 when `alpha` is `false`;
  - depth and stencil: `DEPTH24_STENCIL8`, `DEPTH_COMPONENT16` or `STENCIL_INDEX8`, as `depth` and `stencil` ask.
  - With `antialias: true` they are multisampled, and oxgl resolves them into a single-sample buffer before every read.

  The pbuffer and EGL config selection by size go away. Until the framebuffers change exposes `bindFramebuffer`, this FBO is always the bound framebuffer, and pages see it as framebuffer 0.
- **Context attributes.** `createContext` accepts an `attributes` option, a `WebGLContextAttributes` dictionary (WebGL 1.0 §5.2), and `getContextAttributes()` reports what the context actually got. `alpha`, `depth`, `stencil` and `antialias` are all honoured. `failIfMajorPerformanceCaveat` refuses SwiftShader. **BREAKING:** `antialias` defaults to `true`, as the IDL says, so the default drawing buffer is multisampled.
- **`gl.canvas` and resizing.** `createContext` accepts an optional `canvas` option, and `gl.canvas` returns that object. Without it, oxgl creates a `HeadlessCanvas`: an `EventTarget` with `width`/`height` whose setters resize the drawing buffer. A non-standard `resize(width, height)` on the context does the same for a caller's own canvas. A resize reallocates and clears the drawing buffer and keeps all other state (WebGL 1.0 §2.2). `createContext` now accepts a width or height of `0`. That side of the drawing buffer becomes 1 pixel, so a 0×10 request gets a 1×10 buffer.
- **The conformance harness** passes the page's attributes and canvas element to `createContext`, and resizes the drawing buffer when a page changes the canvas's `width` or `height`. Expectations are regenerated.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-creation`:
  - `createContext` takes `canvas` and `attributes` and accepts zero sizes.
  - The drawing buffer's format follows the attributes, including multisampling.
  - New requirements cover `getContextAttributes`, `failIfMajorPerformanceCaveat`, `gl.canvas`, `HeadlessCanvas`, resizing, reads of an antialiased buffer, and the drawing buffer appearing as framebuffer 0.
- `conformance-testing`: `getContext` passes the attributes and the canvas element, and canvas resizes reach the drawing buffer. The rejected-creation scenario no longer relies on a 0×0 canvas.

## Impact

- `crates/oxgl-sys`:
  - context creation without a pbuffer;
  - new GLES entry points: framebuffer and renderbuffer creation, storage, attachment and status, and `glBlitFramebuffer` / `glBlitFramebufferANGLE`;
  - requesting `GL_OES_rgb8_rgba8`, `GL_ANGLE_framebuffer_multisample` and `GL_ANGLE_framebuffer_blit` on WebGL 1 contexts.
- `crates/oxgl-core`: `DrawingBuffer` owns the FBOs and renderbuffers, allocates them from the attributes, resolves before reads, and reallocates on resize. It also gains `getContextAttributes` and resize.
- `crates/oxgl-node`: `getContextAttributes` and `resize` exports, plus attributes on `createContext`; `native_abi_version` goes up.
- `src/context.ts`: the new `createContext` options, `getContextAttributes`, `canvas`, `resize`, and the `HeadlessCanvas` class, exported from `src/index.ts`.
- `conformance/page.mjs` and `conformance/expectations.txt`; tests under `test/`; `README.md` (the new options, `resize`, and passing `gl.canvas` to three.js).
- Depends on `context-state`, whose `getParameter` the tests need, and on `harness-2d-canvas`, which modifies the same conformance requirement ("Pages obtain oxgl contexts through canvas") and rebases this change's delta of it. Both land first, in that order.

## Out of Scope and Extension Points

- **`bindFramebuffer` and the rest of the framebuffers API.** The framebuffers change maps framebuffer `null` to this drawing buffer. It also answers `FRAMEBUFFER_BINDING`, `getFramebufferAttachmentParameter` with `BACK`/`DEPTH`/`STENCIL`, `drawBuffers([BACK])`, `readBuffer(BACK)` and `invalidateFramebuffer` for it, and it resolves before `copyTex*` and `blitFramebuffer` reads. It must also validate renderbuffer formats against WebGL's own table, because the ANGLE extensions this change enables on WebGL 1 contexts widen what ANGLE alone accepts (for example `RGB8_OES`).
- **Lost-context events**, `WEBGL_lose_context` and `restoreContext`. `HeadlessCanvas` is an `EventTarget` so the context-loss change can fire them on it.
- **`preserveDrawingBuffer` and `premultipliedAlpha` semantics.** A headless buffer is never presented, so its contents persist (the existing requirement), and both values are only reported.
- **`drawingBufferColorSpace`, `unpackColorSpace` and `drawingBufferStorage`**, which the pinned IDL does not define, and `desynchronized` (reported as `false`) and `powerPreference` (reported as requested), which change nothing for a headless context.
- A `style` object or DOM layout on `HeadlessCanvas`. three.js callers pass `updateStyle: false` to `setSize`.
