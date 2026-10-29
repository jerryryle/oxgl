# Design

## Context

- Today `DrawingBuffer` (`crates/oxgl-core/src/context.rs`) is an EGL pbuffer. Its config is chosen as "RGBA8, 24-bit depth, preferring no stencil", and its size is clamped to the smallest of the pbuffer, renderbuffer and viewport limits. `GlContext::make_current` already supports making a context current without a surface.
- On Linux arm64, the SwiftShader display offers these pbuffer configs, the same for ES2 and ES3: RGBA8 only, with depth/stencil 0/0, 16/0, 24/0 or 24/8, each single-sampled or with 4 samples. macOS SwiftShader also offers alpha-0 versions, so EGL configs differ by platform. Measured in a `linux/arm64` Docker container for `context-state` task 1.1.
- The context is created in WebGL-compatibility mode with robust access and robust resource initialization enabled. In that mode an ES2 context (WebGL 1) can request `GL_OES_rgb8_rgba8`, `GL_ANGLE_framebuffer_multisample` and `GL_ANGLE_framebuffer_blit` through `glRequestExtensionANGLE`, and already has `GL_OES_packed_depth_stencil` and `GL_OES_depth24` enabled. An ES3 context has all of these in core. Measured on Linux arm64 SwiftShader.
- `context-state` lands first. It provides `getParameter`, whose `Object` entries already return `null` for every framebuffer and renderbuffer binding, and the generalized `readPixels` pack-parameter path.

## Goals / Non-Goals

**Goals:** every `WebGLContextAttributes` member is met, or reported unmet only where WebGL allows. The format doesn't depend on which EGL configs a backend offers. Reads of an antialiased buffer see resolved pixels. A resize behaves the same whether it comes from a `HeadlessCanvas`, a caller's canvas or the harness.

**Non-Goals:** the public framebuffer API. Making framebuffer `null` mean this drawing buffer once `bindFramebuffer` exists is the framebuffers change's job; this design keeps that change simple.

## Decisions

### A framebuffer object on a surfaceless context

`Display::create_context` keeps choosing a config only for its renderable bit (ES2 or ES3) and no longer asks for `EGL_PBUFFER_BIT`, sizes or depth. `GlContext::attach_pbuffer` and `max_pbuffer_size` are removed, and the context is always made current surfaceless (`EGL_KHR_surfaceless_context`, which ANGLE always exposes). The size limit becomes the smaller of `MAX_RENDERBUFFER_SIZE` and `MAX_VIEWPORT_DIMS`, through the existing `clamp_size`.

`DrawingBuffer` owns one *draw* framebuffer, and with antialiasing also a single-sample *resolve* framebuffer. Each has its renderbuffers:

| Attachment | Format | When |
|---|---|---|
| color | `RGBA8`, or `RGB8` when `alpha` is `false` | always |
| depth + stencil | `DEPTH24_STENCIL8` at `DEPTH_STENCIL_ATTACHMENT` | `depth` and `stencil` |
| depth | `DEPTH_COMPONENT24` | `depth` only |
| stencil | `STENCIL_INDEX8` | `stencil` only |
| resolve color | the color format, single-sample | `antialias` met |

With `antialias`, the draw framebuffer's renderbuffers use `glRenderbufferStorageMultisample` (ES3) or `glRenderbufferStorageMultisampleANGLE` (ES2) with `min(4, MAX_SAMPLES)` samples, and with no multisampling when that is 0. The draw framebuffer stays bound as both draw and read framebuffer. The renderbuffer binding is restored to 0 after every allocation.

The GL names live for the context's whole life. Resize gives the same renderbuffers new storage rather than new names, so their number is fixed and destroying the context frees them. They are internal GL objects, not WebGL objects, so the slotmap handle rule doesn't apply. oxgl-sys keeps them as plain `GLuint`s inside a type that only `Current` methods can use.

*Alternatives:*
- **Emulating `alpha: false` on an RGBA8 buffer** (mask alpha writes, clear alpha to 1). It misses paths that bypass the color mask, starting with WebGL 2 `blitFramebuffer`, and every later API would have to remember it. An RGB8 renderbuffer leaves that work to ANGLE, which emulates RGB8 internally where a backend lacks it, and dEQP tests that.
- **Keeping the pbuffer.** It can't provide `alpha: false` on Linux arm64 SwiftShader, `stencil` without `depth`, or antialiasing that `copyTexImage2D` can read.

### WebGL 1 contexts request three ANGLE extensions internally

At creation, an ES2 context requests `GL_OES_rgb8_rgba8`, `GL_ANGLE_framebuffer_multisample` and `GL_ANGLE_framebuffer_blit`. This widens what ANGLE accepts on that context, for example `RGB8_OES` as a renderbuffer format and the `READ_FRAMEBUFFER`/`DRAW_FRAMEBUFFER` targets. No WebGL entry point passes those through today:

- `getParameter` gates by its own table (`context-state`), so `MAX_SAMPLES_ANGLE` stays `INVALID_ENUM` on WebGL 1;
- the framebuffers change must validate renderbuffer formats and framebuffer targets against WebGL's own lists before forwarding (proposal: Out of Scope).

### getParameter describes the default framebuffer, not the FBO

ANGLE answers framebuffer-dependent queries for whatever is bound, here oxgl's FBO, and a few of those answers differ from what a default framebuffer reports. This change adds a `DrawingBuffer` kind to `context-state`'s `getParameter` table, answered by `oxgl-core` from what it allocated, without a GL call:

- **`DRAW_BUFFER0`…`DRAW_BUFFER15` and `READ_BUFFER` (WebGL 2):** `BACK` for `DRAW_BUFFER0` and `READ_BUFFER`, and `NONE` for the other indexes below `MAX_DRAW_BUFFERS`, which `Limits` holds. An index at or above `MAX_DRAW_BUFFERS` falls through to ANGLE, which generates `INVALID_ENUM`, so the result is `null` as for any parameter the implementation lacks. ANGLE would report `COLOR_ATTACHMENT0`. The FBO's real draw and read buffers stay `COLOR_ATTACHMENT0`, which is what rendering needs. The framebuffers change maps `BACK` in `drawBuffers`/`readBuffer` onto them.
- **`IMPLEMENTATION_COLOR_READ_FORMAT` and `IMPLEMENTATION_COLOR_READ_TYPE`:** `RGBA` or `RGB`, with `UNSIGNED_BYTE`, from the allocated color format. With antialiasing the bound read framebuffer is multisampled, where ANGLE may refuse the query, and reads always go through the single-sample resolve buffer, whose format this is.

Entries that already match, such as `SAMPLES`, `SAMPLE_BUFFERS`, `ALPHA_BITS`, `DEPTH_BITS` and `STENCIL_BITS`, keep reading from ANGLE, which describes the multisampled draw FBO correctly. Once `bindFramebuffer` exists, the framebuffers change answers these entries from ANGLE whenever a page framebuffer is bound.

### Reads resolve first

With antialiasing met, `Context::read_pixels` resolves before reading:

1. Bind the draw framebuffer as `READ_FRAMEBUFFER` and the resolve framebuffer as `DRAW_FRAMEBUFFER`.
2. Disable the scissor test if it is on. Blits are affected only by pixel ownership and the scissor test (OpenGL ES 3.0 §4.3.3), so color masks and rasterizer discard need no change.
3. Blit the whole color buffer with `NEAREST`.
4. Bind the resolve framebuffer as `READ_FRAMEBUFFER`, run the existing read path, then rebind the draw framebuffer as both read and draw framebuffer and restore the scissor test.

The resolve is a GPU-side copy of one buffer per `readPixels`. That is small beside the read and its CPU copy, so no dirty tracking is added. `copyTex*` and `blitFramebuffer` will call the same helper when they arrive.

### Internal work doesn't disturb the error flags

ANGLE has one set of error flags, which `getError` drains. The resolve and the clear only make calls that are valid by construction, so they generate no errors and leave pending ones alone. Allocation can fail (`OUT_OF_MEMORY`, or an incomplete framebuffer), so before allocating, `DrawingBuffer` moves every error pending in ANGLE into `ErrorState` with `synthesize`. Each `glGetError` call returns one flag, so this takes at most five calls. Then it allocates, checks `glGetError` and `glCheckFramebufferStatus`, and discards what its own calls produced. The page's errors survive and oxgl's never leak.

### Allocation falls back instead of failing

If allocation fails, the steps in order are:

1. Retry without multisampling.
2. Halve both dimensions, keeping the aspect ratio, down to 1×1. WebGL 1.0 §2.2 allows a smaller buffer than requested.
3. If even 1×1 fails, creation throws `OXGL_CONTEXT_CREATION_FAILED`, and a resize marks the context lost.

A depth or stencil format that can't be allocated is dropped and reported unmet. This stays inside the one allocation path and needs no extra state.

Allocation takes a `Limits` value: the maximum size, the maximum sample count and, on WebGL 2, `MAX_DRAW_BUFFERS`, which production reads from GL (`MAX_RENDERBUFFER_SIZE`, `MAX_VIEWPORT_DIMS`, `MAX_SAMPLES` or `MAX_SAMPLES_ANGLE`, `MAX_DRAW_BUFFERS`). `oxgl-core`'s unit tests pass their own `Limits` to cover a backend without multisampling. They also set a `#[cfg(test)]` byte cap on `Limits` that makes any allocation fail as `OUT_OF_MEMORY` would when its storage exceeds the cap, counted as width × height × samples (1 when single-sampled) × bytes per pixel. Counting samples lets a test pick a cap that fails the multisampled attempt but not the single-sampled retry at the same size, and a smaller cap that fails both and forces halving. The cap doesn't exist outside test builds.

### Clearing a new or resized buffer

ANGLE's robust resource initialization already zeroes new storage. Its depth and stencil initial values are not something oxgl should rely on, though, so `clear_drawing_buffer` clears explicitly:

1. Save the scissor test, rasterizer discard (WebGL 2), the color, depth and stencil write masks, and the clear color, depth and stencil values.
2. Set each to its default.
3. Clear the draw framebuffer's color, depth and stencil.
4. Restore everything saved.

Chromium's drawing buffer does the same when it reallocates. Viewport and scissor box are left alone, as §2.2 requires. Creation and resize both use it.

### Context attributes and failIfMajorPerformanceCaveat

`ContextRequest` gains an `Attributes` struct. `oxgl-core` stores the allocated `alpha`, `depth`, `stencil` and `antialias` together with the requested `premultipliedAlpha`, `preserveDrawingBuffer`, `powerPreference` and `failIfMajorPerformanceCaveat`, and returns them for `getContextAttributes`.

`createContext` already resolves `OXGL_BACKEND` in TS. With `failIfMajorPerformanceCaveat` set, `'auto'` becomes `'gpu'`, so the existing `OXGL_GPU_UNAVAILABLE` path reports a missing GPU. `'software'` throws `OXGL_CONTEXT_CREATION_FAILED` before any native call.

### Resize and HeadlessCanvas

`DrawingBuffer::resize` drains errors, gives the same renderbuffers new storage with the existing `clamp_size` and the fallbacks above, and clears with `clear_drawing_buffer`.

`HeadlessCanvas` (in `src/context.ts`, guarded by the same constructor token as the contexts) holds its context and private `#width`/`#height` fields. A JS `#` member is visible only inside its own class body. So each class grants the other exactly one operation through a module-scoped function variable that its `static {}` block assigns. This is the standard "friend" pattern, available at the package's ES2023 target. A type-checked sketch passed `tsc --strict` and ran:

- `ContextBase`'s static block sets `resizeDrawingBuffer = (gl, w, h) => gl.#resizeTo(w, h)`. `#resizeTo` calls native `resize`, updates `drawingBufferWidth`/`Height` from the returned (clamped) size, and does nothing when lost. It never touches the canvas.
- `HeadlessCanvas`'s static block sets `storeCanvasSize = (canvas, w, h) => { canvas.#width = w; canvas.#height = h; }`. It only stores; it never resizes.

The two paths meet without calling back into each other:

- A canvas setter converts per WebIDL `unsigned long` and replaces a value above 2147483647 with the default (300 or 150), as HTML's canvas reflection does. It stores the result in its own field, then calls `resizeDrawingBuffer` with both fields.
- The public `resize(width, height)` rejects negative, fractional or above-2147483647 values with `RangeError`. On a `HeadlessCanvas` context it calls `storeCanvasSize` with the *requested* size, then `this.#resizeTo`.

The canvas always reports the requested size and `drawingBufferWidth` the allocated one, as in a browser. The canvas and the context reference each other, which costs the garbage collector nothing.

### The harness passes its canvas and forwards resizes

`installShim` calls `createContext({ width, height, webgl2, canvas: this, attributes })`, where `attributes` is the second argument of `getContext`. jsdom's property setters write the content attribute internally, without going through the JS `setAttribute`, so the harness hooks both paths:

- It wraps the `width` and `height` accessors of jsdom's `HTMLCanvasElement.prototype`, taken from `Object.getOwnPropertyDescriptor`.
- It wraps `Element.prototype.setAttribute`, `setAttributeNS`, `removeAttribute` and `toggleAttribute` for a canvas's `width`/`height`.

Each wrapper calls the original, then `gl.resize(this.width, this.height)` when the canvas has a context. A `MutationObserver` was rejected because it fires a microtask later, after the page has already read `drawingBufferWidth`.

### Safety rules

- **Unsafe confinement:** the new framebuffer, renderbuffer, blit and extension-request entry points are `Current` methods in `oxgl-sys` with `// SAFETY:` comments. `glGenFramebuffers`/`glGenRenderbuffers` write into a local `GLuint`. Everything else passes values. `oxgl-core` and `oxgl-node` stay free of hand-written `unsafe`.
- **No panics:** allocation and fallback return `Result`. Sizes are converted with `try_from`. A context that cannot be made current is marked lost by the existing `current()` helper.
- **Handle model:** the internal framebuffer and renderbuffer names are not WebGL objects and never reach JS. `getParameter` keeps reporting `null` for every binding, from `context-state`'s `Object` entries.
- **ArrayBuffer lifetime:** unchanged. The resolve happens before the existing staging copy in `readPixels`.

## Risks / Trade-offs

- [Antialiasing by default costs memory: 4 samples of color and depth plus a resolve buffer, about 9× a single-sample RGBA8 buffer] → It is the WebGL default and what browsers allocate. Callers who don't need it pass `antialias: false`. The GC-reclaim test keeps up to 100 dropped 256×256 contexts alive between collections, so its peak native memory grows by about 200 MB. Its pass criterion compares resident memory after forced collections, not the peak, so the result shouldn't change, but task 5.2 records the peak and the measured growth on the 4-CPU arm64 runner to confirm it.
- [A backend can't multisample one of the formats] → Allocation retries without multisampling and reports `antialias: false`.
- [The ANGLE extensions requested on WebGL 1 widen ANGLE's validation] → Nothing reaches them yet. The framebuffers change validates against WebGL's own lists (proposal: Out of Scope).
- [Wrapping jsdom's canvas accessors depends on jsdom keeping them on the prototype] → The shim throws at install time if the descriptor is missing, as it already does for `createWindow`.
- [Pages that test antialiasing through `copyTexImage2D` or blits] → They need the textures and framebuffers changes anyway, and those call this resolve helper.

## Migration Plan

The package is unpublished (`0.0.0`), and the ABI bump makes a stale addon fail at load with the existing mismatch error. The visible change for existing callers is the multisampled default buffer. No drawing API exists yet, so only clears are observable, and they are unaffected.
