# Proposal

## Why

Of the 3,159 failing conformance pages in `conformance/expectations.txt`, about 850 stop at a call to context state that oxgl lacks: `clearDepth` (533), `getParameter` (155), `getExtension` (88), `enable`/`disable` (36), `viewport`/`scissor` (18), `getShaderPrecisionFormat` (12), `pixelStorei` (7). Nothing else (buffers, shaders, textures, the drawing buffer's attributes) can be tested until that state can be set and queried, and three.js reads most of it when its renderer starts up.

## What Changes

- **State setters** from WebGL 1.0 §5.14.3 and §5.14.4: `activeTexture`, `blendColor`, `blendEquation[Separate]`, `blendFunc[Separate]`, `clearDepth`, `clearStencil`, `colorMask`, `cullFace`, `depthFunc`, `depthMask`, `depthRange`, `enable`, `disable`, `frontFace`, `hint`, `lineWidth`, `pixelStorei`, `polygonOffset`, `sampleCoverage`, `stencilFunc[Separate]`, `stencilMask[Separate]`, `stencilOp[Separate]`, `scissor`, `viewport`. WebGL 2 contexts accept its extra `enable` caps and `pixelStorei` parameters (WebGL 2.0 §3.7.2).
- **State queries:** `getParameter` returns each parameter with the JS type the spec's table gives it, for WebGL 1 and WebGL 2. The other queries are `isEnabled`, `getShaderPrecisionFormat` (with a `WebGLShaderPrecisionFormat` class), and `flush`/`finish`. Parameters that return a WebGL object return `null` until a later change adds that object type.
- **`isContextLost()`**, plus placeholders for `getSupportedExtensions()` (an empty list) and `getExtension()` (always `null`), so pages can probe for extensions. Real extensions come later.
- **readPixels follows the pack parameters.** Its destination size check uses the current `PACK_ALIGNMENT` and, on WebGL 2, `PACK_ROW_LENGTH`, `PACK_SKIP_PIXELS` and `PACK_SKIP_ROWS`, instead of the fixed alignment of 4. The implementation-chosen read format reported by `getParameter` must succeed.
- Conformance expectations are regenerated.

## Capabilities

### New Capabilities

- `context-state`: the WebGL fixed-function and pixel-store state, its setters, and the `getParameter`/`isEnabled`/`getShaderPrecisionFormat` queries (WebGL 1.0 §5.14.3–§5.14.4, WebGL 2.0 §3.7.2). Later object capabilities extend `getParameter` with their binding parameters.
- `extensions`: the extension query surface (WebGL 1.0 §5.14.14). For now it holds only the empty `getSupportedExtensions` and the `null` `getExtension`. Each extension adds its own requirement later.
- `context-loss`: detecting and handling a lost context (WebGL 1.0 §5.15). It starts with `isContextLost`. Lost-context events and `WEBGL_lose_context` come later.

### Modified Capabilities

- `drawing`: adds `flush` and `finish` (WebGL 1.0 §5.14.11).
- `pixel-readback`: the destination size check follows the pack parameters, and the implementation read format must be accepted.

## Impact

- `crates/oxgl-sys`: new GLES entry points: state setters, `glIsEnabled`, robust boolean/float/integer/int64 getters, `glGetShaderPrecisionFormat`, `glFlush`, `glFinish`, `glPixelStorei`.
- `crates/oxgl-core`: a `getParameter` table and shadow state for the three WebGL-only unpack parameters.
- `crates/oxgl-node`: about 30 new exports; `native_abi_version` goes up.
- `src/context.ts`: the new methods with their WebIDL conversions and the `WebGLShaderPrecisionFormat` class, exported from `src/index.ts`.
- `conformance/expectations.txt`; tests under `test/`.

## Out of Scope and Extension Points

- **The drawing buffer and the context attributes.** The `drawing-buffer` change follows this one. It replaces the pbuffer with a framebuffer object built from `WebGLContextAttributes`, and adds `getContextAttributes`, `gl.canvas`, resizing and antialiasing. It needs this change's `getParameter` to test them. Until it lands, the drawing buffer keeps its current fixed format, and `getParameter(ALPHA_BITS)`, `DEPTH_BITS`, `STENCIL_BITS` and `SAMPLES` report that format.
- **WebGL objects and their bindings.** `getParameter` returns `null` for `ARRAY_BUFFER_BINDING`, `CURRENT_PROGRAM`, `TEXTURE_BINDING_2D`, `FRAMEBUFFER_BINDING` and the other object-valued parameters until the buffers, shaders-programs, textures and framebuffers changes add those objects. Each one swaps its `null` entries for the bound object. `getIndexedParameter` comes with buffers.
- **Every real extension**, and the parameters an extension adds (for example `MAX_TEXTURE_MAX_ANISOTROPY_EXT`). Until then those parameters generate `INVALID_ENUM`.
- **Lost-context events** (`webglcontextlost`/`webglcontextrestored`), `WEBGL_lose_context` and `restoreContext`.
- **Texture upload sources.** The WebGL-only unpack parameters are stored and reported here, but nothing uses them until the textures change. That change must also decide which `TexImageSource` stand-ins Node accepts, for example `ImageData`-like `{ width, height, data }` objects.
- **2D canvas in the harness.** About 100 pages need a 2D context or image loading (`getImageData`, `drawImage`). Whether the harness gets a test-only 2D canvas dependency, or those pages get agreed expectations, is a separate decision.
