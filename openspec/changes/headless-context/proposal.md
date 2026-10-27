# Proposal

## Why

This is the first change that renders anything: it proves the full vertical slice (JS → napi-rs → oxgl-core → oxgl-sys → ANGLE → GPU or SwiftShader → pixels back into a JS typed array) on a deliberately tiny API surface. Getting the context lifecycle, backend selection, error state, and memory behavior right here sets the patterns every later WebGL capability builds on.

## What Changes

- Export `createContext({ width, height, backend, webgl2 })` from `oxgl`, returning a headless WebGL 1 or WebGL 2 context backed by an ANGLE EGL context (pbuffer or surfaceless; no window system).
- `backend: 'auto' | 'gpu' | 'software'` (default `'auto'`): `'auto'` tries the platform GPU backend (Vulkan on Linux, Metal on macOS, D3D11 on Windows) and falls back to SwiftShader; `'gpu'` fails if no GPU backend is usable; `'software'` forces SwiftShader. The `OXGL_BACKEND` environment variable overrides the option.
- The returned context supports only: `drawingBufferWidth`, `drawingBufferHeight`, `clearColor`, `clear`, `readPixels` (ArrayBufferView form), `getError`, the WebGL constants those members use, and a non-standard `destroy()`.
- `destroy()` releases all native resources immediately and puts the context into the WebGL lost state; garbage collection of an undestroyed context releases them too.
- Introduce the core runtime structures later capabilities reuse: per-context error state, lost flag, generational handle registry and deferred-deletion queue (empty in this change), and the backend probe abstraction.
- Tests: clear-then-readPixels under GPU (when available) and forced software, error-path tests, and a 1,000-context create/destroy soak test with a resident-memory threshold.

## Capabilities

### New Capabilities
- `context-creation`: `createContext` options, validation, WebGL 1/2 selection, drawing buffer allocation and size reporting, initial contents, and the `destroy()` lifecycle including resource release.
- `backend-selection`: Choosing between GPU backends and SwiftShader, the `auto` fallback, the `OXGL_BACKEND` override, and failure reporting.
- `drawing`: Writing to the drawing buffer; in this change `clearColor` and `clear` (WebGL 1.0 §5.14.3, §5.14.11).
- `pixel-readback`: `readPixels` into an ArrayBufferView (WebGL 1.0 §5.14.12).
- `error-reporting`: The WebGL error flag model and `getError`, including lost-context behavior (WebGL 1.0 §5.14.3, OpenGL ES 2.0 §2.5).

### Modified Capabilities

None.

## Impact

- `oxgl-sys`: runtime loading of the ANGLE bundle, EGL/GLES bindings (generated from bundle headers), debug-callback trampolines, and a `node`-feature `napi_view` module for writing into typed-array destinations without Rust references (handling SharedArrayBuffer safely).
- `oxgl-core`: context, backend probe, error state, handle registry, deletion queue.
- `oxgl-node`: `createContext`, `WebGLRenderingContext` / `WebGL2RenderingContext` classes, finalizers.
- `src/` TypeScript types for the new exports; `test/` new suites.
- Depends on `bootstrap-workspace` and `angle-acquisition`.

## Out of Scope and Extension Points

- All other WebGL methods, `getParameter`, `getContextAttributes`, context attributes in options, extensions, shaders, and draw calls. The context classes are the extension point: later changes add members; the WebIDL generator will eventually produce their declarations and argument-conversion glue.
- WebGL 2 `readPixels` overloads with `dstOffset` and `PIXEL_PACK_BUFFER` offsets (need buffers); WebGL 2 `clearBuffer*`.
- Context-loss events, `isContextLost`, `WEBGL_lose_context`, restoration. `destroy()` reuses the lost-state machinery a later `context-loss` change will extend.
- Running the Khronos conformance suite. Scenarios cite the matching tests so a later harness change can run them.
- Selecting a specific GPU among several, or exposing which backend was chosen.
