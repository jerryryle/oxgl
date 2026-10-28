# Design

## Context

See proposal.md for motivation. Builds on `bootstrap-workspace` (crates, lints) and `angle-acquisition` (verified ANGLE bundle staged next to the addon, loaded at runtime by absolute path). Requirements are in `specs/`; this document covers how. The architecture established here (layering, threading, handle registry, error merging) is meant to carry every later WebGL capability.

## Goals / Non-Goals

**Goals:**
- A minimal but production-shaped path from JS to ANGLE and back, honoring every safety rule.
- Reusable structures: backend probe, per-context error state, lost flag, handle registry, deferred-deletion queue.

**Non-Goals:**
- Performance tuning (call batching, avoiding make-current churn beyond a simple cache).
- Multi-GPU selection, backend introspection API.

## Decisions

### 1. Layering

```
src/ (TS)       WebGLRenderingContext / WebGL2RenderingContext classes: WebIDL argument conversion,
                constants, createContext option validation (TypeError/RangeError)
  │ primitives only (f64, u32, i32, typed arrays)
oxgl-node       #[napi] functions; maps core errors to JS Errors with `code`; owns finalizers
oxgl-core       Context, DrawingBuffer, ErrorState, BackendProbe, Registry, DeletionQueue
                (#![forbid(unsafe_code)])
oxgl-sys        libloading-based ANGLE loader; bindgen types from bundle headers; small *safe*
                wrapper API (Egl, Gles) whose methods uphold the FFI invariants internally;
                `napi_view` (feature `node`, used only by oxgl-node): call-scoped `WriteTarget`
                for typed-array destinations, see §7
```

`oxgl-sys` is "raw FFI" plus the thinnest safe wrappers that make it callable from a crate that forbids `unsafe`. Each wrapper documents its invariant once (e.g. "a `GlesContext` method is only callable while that context is current on this thread, enforced by requiring `&Current<'_>`").

**WebIDL conversion happens in TypeScript** before entering native code. *Why:* conversions like `ToNumber` can invoke user `valueOf` and run arbitrary JS; doing them in JS means native code never re-enters JS mid-call, which removes a whole class of reentrancy bugs. The TS classes are the seam a future WebIDL generator will own (`src/generated/`). *Alternative:* convert in Rust via napi-rs `JsUnknown` coercion — rejected for the reentrancy reason and because codegen to TS is simpler to review.

**`OXGL_BACKEND` is read in TypeScript** from `process.env` on every `createContext` call, and the resolved backend is passed to native code. *Why:* in worker threads `process.env` is a per-worker copy that is never written to the OS environment, so a native `getenv` would miss it.

### 2. EGL display per backend

`eglGetPlatformDisplayEXT(EGL_PLATFORM_ANGLE_ANGLE, …)` with:

| backend | `EGL_PLATFORM_ANGLE_TYPE_ANGLE` | `EGL_PLATFORM_ANGLE_DEVICE_TYPE_ANGLE` |
|---|---|---|
| GPU, Linux | `VULKAN` | `HARDWARE` |
| GPU, macOS | `METAL` | `HARDWARE` |
| GPU, Windows | `D3D11` | `HARDWARE` |
| software | `VULKAN` | `SWIFTSHADER` |

No native platform type is passed: the Linux bundle is built without X11 and Wayland support (`angle_use_x11`/`angle_use_wayland = false`), so ANGLE never touches a display server, as `angle/smoke/smoke.c` shows on headless CI. Displays are initialized lazily once per backend in a process-wide cache (`Mutex`-guarded; EGL displays are process-global) and kept for the lifetime of the process. Each display is a single bounded object, so it is never terminated and needs no reference counting across environments. Its one-time allocations stay reachable through ANGLE's global display map, so LeakSanitizer does not report them; if the `asan` job shows otherwise, `.github/lsan-suppressions.txt`'s rules apply (narrow, ANGLE-internal symbols, which needs the unstripped-libraries follow-up). Any GPU initialization failure (display or the probe context, including the CPU-renderer rejection below) is cached per backend for the lifetime of the process, so `'auto'` never retries a missing GPU on every call. A failure to create one context is not cached: it fails that call only (`'auto'` falls back for it), because normal use, such as exhausting GPU memory, can cause it. Failures are not classified by EGL error code. A transient failure (driver reset, TDR) therefore keeps the process on software until it restarts; this is an accepted trade-off recorded in the backend-selection spec.

**GPU vs CPU device check:** after creating a GPU-backend context, `GL_RENDERER` is checked against a small deny-list of CPU implementations (SwiftShader, llvmpipe, lavapipe, WARP/Basic Render Driver). A match counts as "GPU unavailable" and is cached for the process (see above), so the probe context is created at most once. The deny-list lives in `oxgl-core` and is unit-tested.

### 3. Context and drawing buffer

- Config: RGBA8888 + depth 24, no stencil, `EGL_PBUFFER_BIT`, ES2 or ES3 renderable.
- Context attribs: client version 2 (WebGL 1) or 3 (WebGL 2); `EGL_CONTEXT_WEBGL_COMPATIBILITY_ANGLE = TRUE` (ANGLE's WebGL validation mode, as used by Chromium); `EGL_ROBUST_RESOURCE_INITIALIZATION_ANGLE = TRUE` (zero-initialized resources); robustness with `LOSE_CONTEXT_ON_RESET` so device loss is observable; bind-generates-resource and client arrays disabled.
- **Initial contents:** the pbuffer is not created with `EGL_ROBUST_RESOURCE_INITIALIZATION_ANGLE`, because on ANGLE's Metal backend (angle-8078.1) that crashes the first `glClear`. Instead `DrawingBuffer` clears color, depth, and stencil once at creation, while the clear values are still their defaults, as Chromium's `DrawingBuffer` does. This gives the "initially transparent black" guarantee on every backend.
- **Drawing buffer = EGL pbuffer** in this change, wrapped in a `DrawingBuffer` type. Size is clamped to `min(EGL_MAX_PBUFFER_*, MAX_RENDERBUFFER_SIZE, MAX_VIEWPORT_DIMS)` with aspect ratio preserved (WebGL §2.2). *Alternative:* surfaceless context + oxgl-owned FBO (Chromium's approach, needed later for `antialias`, resize, and `preserveDrawingBuffer` semantics). Deferred: it requires virtualizing framebuffer binding 0, which belongs with the framebuffers capability. `DrawingBuffer` hides the choice so the switch is internal.
- `antialias: false` in this milestone (allowed: `antialias` is a hint, WebGL §5.2.1). No presentation ever occurs, so contents persist.

### 4. Threading, current context, and registry

Contexts are thread-affine: a context is created, used, and destroyed on the thread of the Node-API environment that created it (main thread or a worker). Per environment, `oxgl-node` keeps an instance-data `Runtime` holding:

- `contexts: SlotMap<ContextKey, Context>` — the JS object stores only the generational `ContextKey`, as two u32 values (slot index, version). A slotmap key is 64 bits, and JS numbers are exact only up to 2^53, so it never crosses the JS boundary as a single number. A stale key (destroyed context) resolves to "lost", never to a dangling pointer.
- Current-context cache: `GlContext::make_current` in `oxgl-sys` skips `eglMakeCurrent` when `eglGetCurrentContext`/`eglGetCurrentSurface` already match, so the `Runtime` keeps no copy that could go stale.
- `deletion_queue: Vec<Deferred>` — see §5.

Each `Context` owns its own `SlotMap` for future WebGL objects (buffers, textures, …), so destroying a context drops every handle it owns in one place, satisfying "destroying or losing a context invalidates all its handles".

### 5. Destroy, finalizers, and the deletion queue

- `destroy()`: makes the context current, releases GL objects it owns, destroys pbuffer and context, removes it from the slotmap, sets the JS-side lost flag. Synchronous.
- **GC of an undestroyed context:** each JS context object is registered with one module-level JS `FinalizationRegistry`. Its held value is only the context's key as a frozen `[index, version]` pair of u32 numbers, and its cleanup callback is a module-level function that captures nothing, so neither keeps the context reachable. `destroy()` unregisters the context. The callback runs as its own task on the owning thread, never inside native code or during GC. It calls native `release(key)`, which enqueues the context's deletion and then drains the queue, following the finalizer rule in `CLAUDE.md`. Because the same call both enqueues and drains, no other trigger has to run first. Contexts have **no** Node-API finalizer. A Node-API finalizer can run while native code holds `&mut Runtime` (e.g. during a JS allocation inside a napi call), so it couldn't drain safely. A stale key is a no-op. The `Runtime` is Node-API instance data, and its finalizer, which Node runs at environment teardown on the environment's thread, destroys any contexts still live. That finalizer is the environment cleanup hook. No experimental Node-API features are used, so the N-API 9 target holds.
- **Deletion queue:** shared by contexts (through `release`) and future child objects (buffers, textures, …), whose Node-API finalizers only enqueue. It is also drained at the start of every oxgl native call on that environment and by environment teardown. Later object types (buffers, textures) reuse the same queue.

### 6. Error state

`ErrorState` holds the set of pending error codes (one flag per error code, the usual reading of the error model in OpenGL ES 2.0 §2.5) for errors synthesized by oxgl's own validation. `getError()` returns a synthesized flag if any, else drains one `glGetError()` from ANGLE. When the context is lost: first call returns `CONTEXT_LOST_WEBGL`, then `NO_ERROR`. Device loss is detected through `glGetGraphicsResetStatusEXT` (checked in `getError` and after `readPixels`) and `EGL_CONTEXT_LOST` from `eglMakeCurrent`; any of these flips the context to lost.

Validation split: oxgl-core checks what ANGLE cannot see (lost flag, ArrayBufferView element type vs `type`, view byte length vs required size, `null` destination); everything else (enum validity, negative sizes) is left to ANGLE's WebGL-compatibility validation so behavior matches Chromium.

### 7. readPixels

The destination may be a view on a `SharedArrayBuffer` (the IDL marks it `[AllowShared]`) that another thread writes concurrently, so **no Rust reference (`&[u8]`/`&mut [u8]`) to its memory is ever formed**. A small `napi_view` module in `oxgl-sys` gets the view's data pointer, byte length and element type through `napi_get_typedarray_info`. It wraps them in an opaque `WriteTarget` that is only valid for the current call. `oxgl-sys` first fills a private temporary from the view's required byte range with a relaxed-atomic byte copy. `glReadPixels` then writes into the temporary, and `oxgl-sys` copies the range back into the view with a relaxed-atomic byte copy, only if the read succeeded. The read is `glReadPixelsRobustANGLE` (`GL_ANGLE_robust_client_memory`, available in WebGL-compatibility contexts) with the temporary's length, so ANGLE itself refuses to write past it whatever the pack state; that makes the `oxgl-sys` wrapper sound on its own. The copy-in preserves bytes for out-of-bounds pixels, which ANGLE leaves untouched in the temporary. There is no shared or unshared distinction to get wrong (an `instanceof SharedArrayBuffer` check fails across realms). The extra copy is negligible next to the readback itself. This matches what browsers do (Blink's `RelaxedAtomicWriteMemcpy`), so neither Rust nor ANGLE's C++ races with other JS threads. This keeps `oxgl-sys` the only crate with `unsafe`. Its scope widens from "FFI to ANGLE" to "all FFI" (`openspec/config.yaml`). `napi_view` sits behind an oxgl-sys `node` cargo feature that only `oxgl-node` enables, so the Rust test executables of `oxgl-core`/`oxgl-sys` (including the ASan job) never link Node-API symbols. `oxgl-node` depends on `oxgl-sys` directly for this feature, as the workspace spec allows. oxgl-core computes the required size from `width`, `height`, `format`, `type`, and `PACK_ALIGNMENT` (4) with checked arithmetic (overflow → `INVALID_OPERATION`-equivalent per spec, never a panic) and checks it against the byte length. Out-of-bounds pixels (WebGL §6) are left to ANGLE's WebGL-compatibility mode, which leaves them untouched as Chromium relies on. The "Partially outside region" scenario checks this. oxgl adds its own clipping only if that test fails on some backend.

### 8. JS errors

Core errors are a Rust enum; `oxgl-node` maps them to `Error` objects with stable `code`s: `OXGL_GPU_UNAVAILABLE`, `OXGL_INVALID_BACKEND`, `OXGL_CONTEXT_CREATION_FAILED`, plus `OXGL_NATIVE_MISSING` from bootstrap. Option-shape errors (`TypeError`/`RangeError`) are thrown in TS before native code runs.

### 9. Lost-state `drawingBufferWidth`/`Height`

The WebGL spec does not define these attributes for a lost context. Chromium returns `0` for both once a context is lost through `WEBGL_lose_context` (checked in Chromium 152 for WebGL 1 and 2, task 4.4), so a destroyed context returns `0` too. The JS object answers without a native call.

## Safety Rules

- **Unsafe confinement:** all `unsafe` (library loading, EGL/GLES calls, callback trampolines) is in `oxgl-sys`, each block with `// SAFETY:`. `oxgl-core` reaches GL only through `oxgl-sys`'s safe wrappers, whose "must be current" invariant is encoded as a borrowed `Current<'_>` token.
- **No panics:** checked arithmetic for all size math; `get()`-based lookups; EGL/GL failures become `Result`s mapped to GL errors, lost state, or coded JS errors. Any `extern "C"` callback (e.g. ANGLE debug messages, if enabled) wraps its body in `catch_unwind` and returns normally.
- **Handle model:** contexts are generational `ContextKey`s; JS never holds a pointer. Destroy and loss drop the per-context object slotmap. GC-driven deletion is always enqueued and drained on the owning thread outside native code: contexts through the `FinalizationRegistry` `release(key)` call, future child objects through finalizer enqueue and the next drain.
- **ArrayBuffer lifetime:** `readPixels` uses the view's pointer only within the call through a call-scoped `WriteTarget`. It never forms a Rust reference to the view's memory, which may be shared, and nothing stores the pointer. Covered by the detach-after-read scenario; running the Node suite under ASan (which would sanitize the napi-rs borrow path) is a follow-up noted in `ci-pipeline`.

## Risks / Trade-offs

- [Pbuffer limits differ from renderbuffer limits on some backends] → Clamp to the minimum of all three limits; scenario covers oversized requests.
- [SwiftShader caches inflate RSS and make the soak threshold flaky] → 50-iteration warm-up, forced GC before measuring, threshold (32 MiB) well below the ~500 MB a per-context buffer leak would cause; native live-object counters in Rust integration tests catch small leaks deterministically.
- [Finalizer drain never runs if the app goes idle after dropping contexts] → `FinalizationRegistry` enqueue-and-drain by key plus environment cleanup hook; worst case resources are held until the next oxgl call or exit, never leaked.
- [macOS CI runners expose a paravirtualized Metal device, so `'auto'` picks GPU there] → Software tests use `OXGL_BACKEND=software`; GPU tests skip with a reason when `'gpu'` reports `OXGL_GPU_UNAVAILABLE` or when `OXGL_BACKEND` forces another backend.
- [ANGLE's `ScopedVkLoaderEnvironment` sets `VK_ICD_FILENAMES` and, except on macOS, changes the working directory while initializing the SwiftShader display; both race with other threads] → Accepted until upstream ANGLE fixes it (backend-selection spec, README "Known issues"). SwiftShader is initialized lazily, at the first context that uses it, so GPU-only applications are never exposed; the GPU Vulkan path (default ICD, no debug layers in release builds) changes neither. Patching ANGLE was considered and rejected: its Vulkan function table is process-global, so loading the ICD directly needs an invasive patch to maintain.
- [ANGLE intentionally leaks the per-thread `egl::Thread` (about 72 bytes) it allocates on a thread's first EGL call; `eglReleaseThread` does not free it, and ANGLE hides it from LeakSanitizer only in its own instrumented builds] → Accepted (context-creation spec, README "Known issues"): one small allocation per thread that ever used oxgl, never per context. The Rust tests run all EGL work on one long-lived thread (`on_gl_thread`) so the never-exiting thread keeps that state reachable and the `asan` job's LeakSanitizer stays meaningful without suppressing ANGLE wholesale.
- [ANGLE WebGL-compat validation diverges from the spec in an edge case] → Same behavior as Chromium, which is the practical reference; conformance harness (later) will surface differences.

## Open Questions

- Whether to expose the chosen backend (e.g. via `WEBGL_debug_renderer_info` once extensions exist, or an oxgl-specific property). Not needed for this change's tests.
