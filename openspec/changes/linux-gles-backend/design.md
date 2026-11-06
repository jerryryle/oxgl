# Design

## Context

See proposal.md (Why). What exists today:
- **Selection** (`crates/oxgl-core/src/backend.rs`): `Backends` keeps one display slot per concrete backend (`Gpu`, `Software`). A display failure is remembered for the process, and so is a GPU display whose `GL_RENDERER` names a CPU. A context-creation failure fails only its call. `'auto'` tries GPU, then SwiftShader.
- **Displays** (`crates/oxgl-sys/src/egl.rs`): `Display::open` calls `eglGetPlatformDisplayEXT(EGL_PLATFORM_ANGLE_ANGLE, …)` with a platform type and device type. Contexts are surfaceless (`EGL_KHR_surfaceless_context`). `choose_config` asks only for `EGL_RENDERABLE_TYPE` and takes the first match. Displays are never terminated.
- **Drawing buffer** (`crates/oxgl-core/src/drawing_buffer.rs`): oxgl's own framebuffer with an `RGBA8` (or `RGB8`) color renderbuffer and a `DEPTH24_STENCIL8`/`DEPTH_COMPONENT24`/`STENCIL_INDEX8` renderbuffer, `min(MAX_SAMPLES, 4)` samples when `antialias` is true, and a single-sample resolve framebuffer.
- **Extensions** (`crates/oxgl-core/src/extensions.rs`): a WebGL extension is reported when ANGLE can enable every GL extension it needs, so the list already follows the backend.

### What was verified, and how

| Claim | How | Confidence |
|---|---|---|
| The 0.2.0 Linux bundles lack the GL backend | oxgl-angle `angle/args/common.gn` sets `angle_enable_gl = false` | certain |
| ANGLE on Linux selects `DisplayEGL` for platform type `OPENGLES` with native platform `EGL_PLATFORM_SURFACELESS_MESA` (or device type `EGL`), and builds it without X11/Wayland/GBM | `src/libANGLE/Display.cpp` `CreateDisplayFromAttribs` at the pinned commit `127e783d` | high |
| `DisplayEGL` `dlopen`s `libEGL.so.1` in `DisplayEGL::initialize`, never at load | `DisplayEGL.cpp` `getEGLPath`, `FunctionsEGLDL.cpp` | high |
| With `ANGLE_HAS_LIBDRM` (always defined in a standalone Linux build), `FunctionsEGL` first tries an EGL device whose DRM driver is `i915`, `amdgpu` or `virtio_gpu`, then the surfaceless platform. libdrm comes from `//third_party/libdrm` (MIT) and is linked statically, since `use_system_libdrm` defaults to false on Linux | `FunctionsEGL.cpp` `getPreferredDisplay`, `build/config/linux/libdrm/BUILD.gn` | high; the static link is checked after the build (task 1.3) |
| ANGLE's bundled `libEGL.so` cannot satisfy its own `dlopen("libEGL.so.1")`: the SONAMEs differ (`libEGL.so`, `libGLESv2.so`) | `readelf -d` on the 0.2.0 linux-arm64 bundle | certain |
| The bundle exports no LLVM or libdrm symbols, so it doesn't clash with Mesa's `libLLVM.so.19.1` or `libdrm.so.2` | `nm -D --defined-only` on the 0.2.0 bundle | certain for 0.2.0; rechecked after the build (task 1.3) |
| Pi 5 Mesa (26.2.2) surfaceless EGL 1.5 has `EGL_KHR_no_config_context`, `EGL_KHR_surfaceless_context`, `EGL_EXT_create_context_robustness` and `EGL_MESA_platform_surfaceless`. A robust, no-config, surfaceless ES 3.0 context reports `V3D 7.1.10.2`, `OpenGL ES 3.1 Mesa 26.2.2…`, `MAX_SAMPLES` 4. A 4-sample `RGBA8` + `DEPTH24_STENCIL8` framebuffer is complete with 8-bit red and alpha | C probe on the Pi, run as `baton` | certain |
| Outside `render`, the same probe silently gets `llvmpipe (LLVM 19.1.7, 128 bits)`, `OpenGL ES 3.2` | the same probe as a new user `oxglnorender` with no supplementary groups | certain |
| No EGL config choice reaches Mesa's drawing surfaces. `DisplayEGL` skips `findConfig` when `EGL_KHR_no_config_context` is present and creates native contexts with `EGL_NO_CONFIG_KHR`. oxgl renders only into its own framebuffer. ANGLE's front-end `eglChooseConfig` matches only the attributes given, so oxgl's `[EGL_RENDERABLE_TYPE, ES3_BIT]` matches Mesa's pbuffer-only configs | `DisplayEGL.cpp` `initialize`/`generateConfigs`, `Config.cpp` `ConfigSet::filter` | high |
| Mesa lists 5/6/5 configs first under `EGL_RENDERABLE_TYPE = ES3_BIT`. The 8/8/8/8 configs with 24-bit depth and 8-bit stencil exist at 0 and 4 samples (and 8 under llvmpipe) | the probe | certain; irrelevant to oxgl, per the row above |

Not yet verified, since it needs a bundle with the backend: the renderer string format under ANGLE, which ANGLE features work on V3D, and every item of requirement 5 of the brief (tasks 4.x and 5.x).

## Goals / Non-Goals

**Goals:**
- WebGL 2 on the Pi 5's V3D GPU through `'gpu'` and `'auto'`, with nothing to configure.
- No change on machines where Vulkan gives OpenGL ES 3.0, and no new runtime dependency anywhere.
- The GL code path tested in CI.

**Non-Goals:**
- Making the OpenGL ES backend a general Linux alternative to Vulkan (see proposal, Out of scope).

## Decisions

**Selection is automatic (option 1), not a new `backend` value (option 2).** Recommended for four reasons:
- The goal is that `createContext({ webgl2: true, backend: 'gpu' })` works on the Pi. Option 2 would make every caller, three.js app and test runner on a Pi learn a Linux-only value.
- `'auto'` WebGL 2 on the Pi gets the GPU instead of SwiftShader, which option 2 can't give without also changing `'auto'`.
- The public API stays at three values, so the TypeScript types, `OXGL_BACKEND` validation and the README's backend semantics don't change.
- The trigger is narrow and deterministic. It fires only where Vulkan works but offers no ES 3.0, so other machines are unaffected.

The cost is a third display slot and an ordered candidate list in `Backends`, about the same code option 2 would need. What the user gives up is choosing the GL backend on a machine where Vulkan gives ES 3.0. No requirement asks for that, and the test-only `gles` mode covers testing.

**The trigger: a hardware Vulkan display with no ES 3.0 config.** For a request on Linux, the GPU candidates are:
1. The OpenGL ES backend, tried only when the Vulkan display opened, passed the CPU-renderer check, and offers no `EGL_OPENGL_ES3_BIT` config.
2. Vulkan, as today, except in that case, where it serves no context.

ANGLE exposes no ES 3 config when `getMaxSupportedESVersion` is below 3.0, which is what makes today's `eglChooseConfig` fail with oxgl's `EGL_BAD_MATCH` (0x3009). Whether a display offers ES 3.0 is a fixed property of that display, so it is checked once when the display opens. A Vulkan display without it is terminated, and only that rejection is kept. A Vulkan ES 3 context that fails for another reason (out of memory) still fails only that call and doesn't divert to GL. When Vulkan fails or is rejected as a CPU, behaviour is unchanged: `'gpu'` throws, `'auto'` uses SwiftShader. If GL were tried in those cases, every GPU-less Linux machine with Mesa installed, CI runners included, would load Mesa and llvmpipe into the process just to reject them. That load also brings Mesa into the ASan job.

**The OpenGL ES display.** `DisplayKind::Gles` (Linux only) opens `EGL_PLATFORM_ANGLE_TYPE_ANGLE = EGL_PLATFORM_ANGLE_TYPE_OPENGLES_ANGLE` with `EGL_PLATFORM_ANGLE_NATIVE_PLATFORM_TYPE_ANGLE = EGL_PLATFORM_SURFACELESS_MESA`. `create_context`, `choose_config` and the context attributes are unchanged: ANGLE's front end implements WebGL compatibility, robust resource initialization, robust access and lose-on-reset for every backend. The GL backend asks Mesa for robustness through `EGL_EXT_create_context_robustness`, which Mesa has. It goes in its own slot, `gles`, in `Backends`, with the same failure memory as the others (the existing accepted trade-off covers it).

**The CPU-renderer check covers the OpenGL ES display.** The `GL_RENDERER` check that runs on the GPU display runs on the GLES display too. `CPU_RENDERERS`, which already holds `"llvmpipe"` and `"softpipe"`, gains `"swrast"` and `"software rasterizer"`. In a WebGL context ANGLE builds `GL_RENDERER` as `ANGLE (<vendor>, <renderer>, <version>)`, stripping commas from each part and cutting the version to its number (`Context::initRendererString`, `SanitizeVersionString` in `DisplayGL.cpp`). It reads `ANGLE (Mesa, llvmpipe (LLVM 19.1.7 128 bits), OpenGL ES 3.2)` on llvmpipe and `ANGLE (Broadcom, V3D 7.1.10.2, OpenGL ES 3.1)` on the Pi (read from the source, confirmed in tasks 3.2 and 5.1), and the `llvmpipe` substring matches. The check is skipped only in `test-gles` mode.

**Messages.** `'gpu'` on a WebGL 2 request that reaches GL and fails reports both attempts: `OXGL_GPU_UNAVAILABLE`, "Vulkan: offers OpenGL ES 2.0 only; OpenGL ES: the GPU backend renders on a CPU (ANGLE (Mesa, llvmpipe …))". Without Mesa the second part is `eglInitialize failed (EGL error 0x3001)`, since EGL reports only a code and ANGLE's reason stays in its log, followed by a note that the backend needs the system's EGL driver (`libEGL.so.1`, from Mesa's `libegl1` and `libegl-mesa0`). WebGL 1 gets the same message. `'auto'` adds SwiftShader's cause only when everything fails, as today.

**`Backend` stays two-valued for JavaScript.** The `backend` option keeps its values `'auto'`, `'gpu'` and `'software'`. The concrete display (`Vulkan`, `OpenGL ES`) is internal and shows only in messages and `GL_RENDERER`. In the test-only `gles` mode, `createContext` passes `gles` to the native side and records it with the context's other creation parameters, so a restore after a context loss opens the GLES display again. The report's `backend` field (`OXGL_BACKEND`) says `gles`.

**Test-only mode: Cargo feature `test-gles`.** On `oxgl-node` only. `oxgl-core` always has `RequestedBackend::Gles`, an internal Rust API, so its selection tests run on every platform; only the Node binding's mapping of the `gles` string is gated. With the feature:
- the native module exports `testBackends = ['gles']`;
- `resolveBackend` in `src/context.ts` accepts `OXGL_BACKEND=gles` only when that export lists it, and otherwise rejects it as `OXGL_INVALID_BACKEND` as it does any unknown value;
- `gles` makes every request, WebGL 1 and 2, use the GLES display only, with no CPU-renderer check and no fallback.

The feature compiles on every platform, so `cargo clippy --all-features` works everywhere. Its code is `cfg!(all(feature = "test-gles", target_os = "linux"))`. Elsewhere it does nothing and `testBackends` is empty, so `gles` stays invalid there. `DisplayKind::Gles` is `cfg(target_os = "linux")`; elsewhere `AngleProbe` refuses `Backend::Gles` with an error. `testBackends` is a new native export, so the native ABI version goes to 15.

Release builds and packages never enable the feature, so their `'gpu'` can't accept a CPU. Alternatives considered:
- An environment variable in the release binary: exposes the CPU path publicly.
- Rust-only integration tests: miss the JavaScript-level WebGL behaviour that requirement 5 of the brief asks to verify.

**WebGL 1 uses the OpenGL ES backend on these GPUs.** The original design kept WebGL 1 on Vulkan, since Vulkan serves it. The Pi run reversed that. On V3DV, a WebGL 1 shader that indexes a sampler array with a loop variable, which GLSL ES 1.00 Appendix A allows, segfaults the process at the draw. V3DV reports `shaderSampledImageArrayDynamicIndexing = false`, and ANGLE emits the dynamic index anyway. V3DV records only the array's first element in its descriptor map. Once the loop unrolls, the shader asks for element 1, which has no entry, and `v3dv_descriptor_map_get_descriptor` dereferences a null set. oxgl can't reach that shader code, so it avoids the driver:

| WebGL 1 on V3D | Pass | Fail | Crash | Timeout |
|---|---|---|---|---|
| Vulkan | 963 | 6 | 1 | 0 |
| OpenGL ES backend, before the `generateMipmap` fix below | 965 | 3 | 0 | 2 |
| OpenGL ES backend, final | 966 | 2 | 0 | 2 |

Both were run on `angle-8103.2`, the second with the `test-gles` addon and `OXGL_BACKEND=gles`. With this change built, the Pi gives `ANGLE (Broadcom, V3D 7.1.10.2, OpenGL ES 3.1)` for WebGL 1 and 2 under `'gpu'`, and under `LIBGL_ALWAYS_SOFTWARE=1` both throw `OXGL_GPU_UNAVAILABLE` while `'auto'` renders them on SwiftShader. A `'software'` context after `'gpu'` contexts also renders. A full Pi run with this change is still to do (task 5.7).

The move isn't a plain improvement. On the OpenGL ES backend, in WebGL 1:
- `oes-texture-float-linear.html` failed because the context was lost. V3D's GL driver has no `OES_texture_float_linear`, so oxgl correctly doesn't list it, and LINEAR float textures sample black as they should. But `generateMipmap` on a float texture reaches the driver: ANGLE's validation passes unsized formats, the driver refuses the call, and ANGLE turns that error into a context loss (`GL_INVALID_OPERATION` would be the right result, and the page allows it). This affects WebGL 1 apps on V3D that generate mipmaps for float textures. oxgl generates that error itself: on this backend, when `OES_texture_float_linear` isn't supported, WebGL 1's `generateMipmap` reads the base level's channel sizes with `GL_ANGLE_get_tex_level_parameter` and refuses 32-bit ones, which only float textures have in WebGL 1. The other backends generate these mipmaps themselves, so the check doesn't apply to them; the context records its backend for this. `LUMINANCE` has no size to read, but V3D's driver accepts it. The page passes on the Pi with this check. oxgl keeps no record of texture formats, and the query needs none. An ANGLE patch in `ValidateGenerateMipmapBase` would need another release for the same result.
- `khr-parallel-shader-compile.html` and `offscreencanvas-transfer-image-bitmap.html` time out, as they do in WebGL 2 on this backend. They aren't a hang in basic use. On V3D a program's `COMPLETION_STATUS_KHR` is true at once, without polling, and a context in a worker renders. The first page's stress step compiles very large shaders, and this backend's synchronous compile could block for the harness's 60 s limit, but that isn't proven. The cause of the second is unknown.

WebGL 1 uses the OpenGL ES backend under the same trigger, and Vulkan serves no context there. If the OpenGL ES backend is unavailable, `'gpu'` throws and `'auto'` uses SwiftShader. oxgl terminates the Vulkan display once it finds ES 2.0 only, so it holds no device, and SwiftShader can initialize, and a process can use both V3D and SwiftShader. A Vulkan fallback for WebGL 1 was tried and dropped: a missing `libegl-mesa0` is an ordinary install, and it left the process open to the crash. What the user gives up is the GPU for WebGL 1 on a Pi without Mesa's EGL. The alternatives were an ANGLE translator pass rewriting the index, a large patch for one driver, and a Mesa fix, which reaches users only with a Mesa release. It is worth reporting there too.

**The OpenGL ES display disables one ANGLE feature.** `readPixelsUsingImplementationColorReadFormatForNorm16` works around a read bug on some OpenGL ES drivers by reading `RG16` as `RG`/`UNSIGNED_SHORT`. Mesa has no such bug: its own read format for `RG16` is `RGBA`, so it refuses `RG`, and ANGLE turns the error into a context loss on a legal `readPixels`. Plain Mesa reads `R16`, `RG16` and `RGBA16` correctly on V3D and llvmpipe, and with the feature disabled `ext-texture-norm16.html` passes on the Pi. ANGLE's feature override is a pointer attribute, which `eglGetPlatformDisplayEXT`'s `EGLint` list can't carry, so `Display::open` uses `eglGetPlatformDisplay`. This needs no ANGLE release.

**`drawRangeElements` is `drawElements`.** On the OpenGL ES backend the call reaches the driver with its range. `deqp/functional/gles3/draw/draw_range_elements.html` draws with `start` and `end` of 5 and indices `[4, 0, 2, 6, 7]`. llvmpipe subtracts `start`, so 4 wraps to 65535, and it reads out of bounds, which is a SIGSEGV or an image mismatch. WebGL 2.0, "Writing to the drawing buffer", lets an implementation "simply discard the arguments start and end and call drawElements instead", so oxgl does, after generating `INVALID_VALUE` for `end < start`. ANGLE's Vulkan and Metal backends ignore the range already, so the cost is limited to the hint a GLES driver no longer gets.

**Expectations target `linux-x64-gles`.** `PLATFORMS` in `conformance/expectations.mjs` gains `linux-x64-gles`, last. The conformance and three.js runners already create contexts with no `backend` option and record `OXGL_BACKEND` in their reports, so the override reaches every page unchanged. `scripts/results-page.mjs` builds its columns from `PLATFORMS`, so the page gains a linux-x64-gles column with no code change beyond the spec's order. The host target is `linux-x64-gles` when `OXGL_BACKEND=gles`, and the platform name otherwise. An entry without platforms still applies to every target, so the shared entries (ANGLE's `__` identifiers, the JS-engine page) apply to `gles` with no edit. An update run on `gles` narrows entries as it does for any platform. The three.js runner imports the same list.

**CI.** Within "Each platform is built once per run", the Linux x64 build job also builds the addon with `--features test-gles`, after it has packed the release packages and into a separate directory (`napi build --output-dir dist-gles`), so the packed `dist/oxgl.linux-x64-gnu.node` is never overwritten. It uploads that addon as `addon-linux-x64-gles`, never packed or released. The job's existing pack check confirms the packed addon rejects `gles`. A new `gles` job on `ubuntu-24.04`:
1. installs `libegl1 libegl-mesa0 libgl1-mesa-dri`;
2. unpacks the run's Linux x64 packages, then replaces the addon with the `test-gles` one;
3. runs `npm test`, both conformance suites and the three.js examples with `OXGL_BACKEND=gles`.

The aggregate `ci` check requires it. The job adds one Linux x64 copy of the long suites to every full run. The alternative, Node tests only on GLES, keeps CI shorter but leaves conformance on this backend to manual runs. This is open question 1.

**Bench.** `bench/run.mjs` accepts `--webgl1`, which creates its contexts with `webgl2: false`, on the OpenGL ES backend on a Pi since the WebGL 1 decision above. The default stays WebGL 2.

**ANGLE recipe (oxgl-angle).**
- `angle_enable_gl` moves out of `common.gn`: `true` in both Linux files, `false` in the macOS and Windows files.
- `angle_enable_gl_desktop_backend = false` on Linux. It drops desktop GL support, which oxgl never selects; the GLES-on-EGL path builds and runs without it (below).
- `angle_use_x11`, `angle_use_wayland` stay `false`; `angle_use_gbm` stays at its default `false`.
- `bundle.py` requires `angle_enable_gl = true` on Linux. It fails if a Linux library has a `NEEDED` entry for `libEGL.so.1`, `libGL`, `libGLESv2.so.2`, `libgbm` or `libdrm`, or exports `drm*` symbols.
- `smoke.c` is unchanged, since it renders with SwiftShader. The build host has no Mesa, so loading the bundle and rendering there also shows the GL backend adds no load-time dependency.
- New `bundle_version` `angle-8078.8`. oxgl's `angle/bundles.toml` follows in this change, and later releases carry the fixes recorded below, up to `angle-8103.2`.
- A source patch, `angle-gles-rgb8-implementation-read-format.patch`, in `angle-8078.9` and every release after it (oxgl now pins `angle-8103.2`). ANGLE's OpenGL backend advertised `RGB`/`UNSIGNED_BYTE` as the implementation read format of an `RGB8` color buffer and passed an `RGB` read to the driver unchanged. An OpenGL ES driver need accept only `RGBA`/`UNSIGNED_BYTE` and its own chosen pair (ES 3.0.6 §4.3.2), and Mesa chooses `RGBA` for `RGB8`, so it rejected the read; in a WebGL context ANGLE turns that driver error into a context loss (`loseHardenedContextOnBackendError`). Every `alpha: false` context lost its context on a `readPixels` in the advertised format, on llvmpipe and on the Pi's V3D. With the patch, ANGLE advertises `RGBA` for `RGB8` over an OpenGL ES driver and refuses an `RGB` read itself with `INVALID_OPERATION`. The alternative, a read-and-convert path in oxgl, would have to handle pack parameters and pixel pack buffers, and would cover only reads that go through oxgl's checks.

Results for the released `angle-8078.8` bundles (task 1.3):
- `readelf -d`: on both Linux platforms, every library needs only glibc (`libc`, `libdl`, `libpthread`, the dynamic loader), `libgcc_s` and, except `libEGL.so`, `libm`. `nm -D --defined-only` shows no `drm*` or LLVM symbols.
- The smoke test passed in the release run on both Linux platforms, on hosts without Mesa.
- `libGLESv2.so` grew from 6,668,512 to 7,290,160 bytes on Linux x64 (+9.3%) and from 6,513,528 to 7,098,160 bytes on Linux arm64 (+9.0%), against `angle-8078.7`. `libEGL.so` and `libvk_swiftshader.so` are unchanged in size.
- On the Pi (Linux arm64), a C probe linked against the bundle's libraries opened `EGL_PLATFORM_ANGLE_TYPE_OPENGLES_ANGLE` on `EGL_PLATFORM_SURFACELESS_MESA`, created an ES 3 context, and cleared and read back an RGBA8 framebuffer. As `baton` its renderer was `ANGLE (Broadcom, V3D 7.1.10.2, OpenGL ES 3.1)` with `MAX_SAMPLES` 4; as `oxglnorender` and with `LIBGL_ALWAYS_SOFTWARE=1` it was `ANGLE (Mesa, llvmpipe (LLVM 19.1.7 128 bits), OpenGL ES 3.2)` with `MAX_SAMPLES` 8.

Results without Mesa (task 3.1), with oxgl built in each container against `angle-8078.8`, in `ubuntu:24.04` with no EGL, GL or DRI files installed:
- Linux arm64 (native): `ldd` on the addon and every library in `dist/angle/` shows only glibc, `libgcc_s` and `libm`. Under `strace -f -e openat`, contexts on `'auto'`, `'software'` and the default backend, WebGL 1 and 2, rendered on SwiftShader; `'gpu'` threw `OXGL_GPU_UNAVAILABLE` (`Vulkan: eglInitialize failed (EGL error 0x3001)`, no GPU in the container). No path naming `libEGL.so.1` was opened; the only EGL or GL files opened were the bundle's `libEGL.so` and `libGLESv2.so`.
- Linux x64 (`--platform linux/amd64`, emulated): the same `ldd` and context results. `strace` records nothing under emulation, so the dynamic loader's log (`LD_DEBUG=files`) stands in: it loaded the bundle's `libEGL.so`, `libGLESv2.so`, `libvulkan.so.1` and `libvk_swiftshader.so`, and never looked up `libEGL.so.1`.

Results on llvmpipe (task 3.2), with oxgl built with `test-gles` against `angle-8078.9` in a `linux/arm64` `ubuntu:24.04` container with `libegl1 libegl-mesa0 libgl1-mesa-dri`: `GL_RENDERER` is `ANGLE (Mesa, llvmpipe (LLVM 20.1.2 128 bits), OpenGL ES 3.2)`, which `is_cpu_renderer` matches. `OXGL_BACKEND=gles npm test` passed 427 of 436 tests, with 8 skipped. The one failure was the conformance harness's video page, which needs `ffmpeg`; with `ffmpeg` installed, the harness tests passed 53 of 53. Against `angle-8078.8` the `alpha: false` read-format test lost its context, which is what the `angle-8078.9` patch fixes. Rebuilt against `angle-8103.1`, with `ffmpeg` installed, the same run passed 428 of 436, with 8 skipped and none failing, on the same renderer.

**Safety rules.**
- Unsafe confinement: the new display kind is another attribute list for `eglGetPlatformDisplayEXT`, inside `oxgl-sys` under the existing `// SAFETY:` comment; `supports_es3` reuses `choose_config`. The new FFI functions are `eglTerminate`, for a GPU display rejected as a CPU or offering ES 2.0 only, and `glGetTexLevelParameterivANGLE`, for `generateMipmap`'s check, each with its own `// SAFETY:` comment. No unsafe outside `oxgl-sys`.
- No panics: new paths return `Result`/`String` errors like the existing ones.
- Handle model and ArrayBuffer lifetime: untouched. Contexts on the new display are ordinary `GlContext`s, with the same thread affinity and drop order.

**One Vulkan device per process on Linux** (Open Question 3, backend-selection "One Vulkan device per process on Linux"). ANGLE keys its platform displays without the device type (`Display::GetDisplayFromNativeDisplay`), so the Vulkan GPU and SwiftShader displays are one display, and only the first initialization picks the device. A display whose `eglInitialize` failed takes the next request's attributes, so SwiftShader after a failed GPU works as before. Separate display keys would make two Vulkan renderers in one process, which crashed (Results on the Pi). So `Backends` makes the sharing explicit. On Linux, whichever of the GPU and software displays initializes on an accepted device holds Vulkan, and a request for the other fails, naming the holder. A GPU display whose renderer is a CPU, or a Vulkan display offering ES 2.0 only, is terminated with `eglTerminate` right after that check, and holds nothing. That frees it for SwiftShader instead of leaving `'software'` on lavapipe, which is what happened before on a GPU-less machine with Mesa's Vulkan driver after an `'auto'` context (seen in a `linux/arm64` container). The terminated display is never used again: its slot keeps only the rejection. Terminating is the one new EGL entry point, inside `oxgl-sys`. `Display::terminate` does nothing while another handle from the same open exists, a live context's included. It can't see another open of the same ANGLE display, which the holder rule covers: the GPU display is never opened while SwiftShader holds it. A backend that already opened or failed keeps that result, so a refusal names the other backend only for a display never opened. The cost is that a Linux process can't use a Vulkan GPU and SwiftShader at once. `'auto'` is unaffected unless the process already uses SwiftShader, in which case it gets SwiftShader again. On the Pi without Mesa's EGL, WebGL 2 `'auto'` now fails with both causes named instead of `eglChooseConfig failed`.

## Risks / Trade-offs

- **Mesa in the process** → loaded only on the trigger above. Mesa's llvmpipe or V3D screen, and any threads it starts, live until exit because displays are never terminated. That is the existing display model, and it doesn't grow with contexts (task 4.3 checks that repeated contexts don't grow the thread count or memory).
- **Exit with a live Mesa display** → a process that used GL exits through Node's normal teardown. Task 4.3 checks that this doesn't crash, on the Pi and in the CI job.
- **llvmpipe GL results stand in for V3D in CI** → CI proves oxgl's GL code path, not V3D. The Pi runs are recorded here and in the README.

## Accepted trade-offs

- A machine whose Vulkan driver gives ES 2.0 and whose GL driver fails once at initialization keeps failing (`'gpu'`) or using SwiftShader (`'auto'`) until restart. The existing "GPU initialization failure is remembered" trade-off, extended to the third display.
- WebGL 1 on V3D through the OpenGL ES backend keeps the two conformance timeouts above, whose causes aren't established.
- `generateMipmap` on a `LUMINANCE` float texture isn't refused, because ANGLE reports no size for it. A driver other than V3D's that refuses the call would lose the context. V3D is the one GPU known to take this path.

## Results on the Pi

Raspberry Pi 5 on Debian 13 (Raspberry Pi OS), Mesa 26.2.2, oxgl built against `angle-8103.1` (the arm64 container build, glibc 2.39, run on the Pi's 2.41), Node 26.7.0. `libegl1` and `libegl-mesa0` were already installed, as was `libgles2`; oxgl doesn't need `libgles2`: a GLES context maps the bundle's `libGLESv2.so` and Mesa's `libEGL.so.1`, `libEGL_mesa.so.0`, `libGLdispatch.so.0` and gallium, and no system `libGLESv2.so.2`. Conformance, three.js and `npm test` were rerun against `angle-8103.2`, with the same WebGL 1 and three.js results; the WebGL 2 line and the llvmpipe line below say what changed. Other results here are from `angle-8103.1`.

- RGB8 read (task 1.5): a C probe on the bundle's libraries, with a WebGL-compatible ANGLE context on V3D, reports `RGBA`/`UNSIGNED_BYTE` as the read format of an `RGB8` framebuffer, reads it without error, and keeps the context. A read as `RGB` is refused with `INVALID_OPERATION`, and the reset status stays `NO_ERROR`. Against `angle-8078.8` the advertised format was `RGB` and the read lost the context.
- WebGL 2 `'gpu'` (task 5.1): renderer `ANGLE (Broadcom, V3D 7.1.10.2, OpenGL ES 3.1)`. RGBA, depth and stencil bits are 8/8/8/8/24/0 with default attributes. `SAMPLES` is 4 with `antialias: true` and 0 without. A clear reads back exactly, with no error or loss.
- WebGL 1 `'gpu'` on Vulkan, before the decision "WebGL 1 uses the OpenGL ES backend on these GPUs": `ANGLE (Broadcom, Vulkan 1.3.354 (V3D 7.1.10.2 (0x55701C33)), V3DV Mesa)`, with 8/8/8/8 bits and `SAMPLES` 4.
- Refusals (task 5.2):
  - With `LIBGL_ALWAYS_SOFTWARE=1`, WebGL 2 `'gpu'` throws `OXGL_GPU_UNAVAILABLE`: "Vulkan: offers OpenGL ES 2.0 only; OpenGL ES: the GPU backend renders on a CPU (ANGLE (Mesa, llvmpipe (LLVM 19.1.7 128 bits), OpenGL ES 3.2))". WebGL 1 still gets V3DV.
  - As `oxglnorender`, Mesa can't open `/dev/dri`, so Vulkan itself falls to lavapipe. Every `'gpu'` request then throws `OXGL_GPU_UNAVAILABLE` with "Vulkan: the GPU backend renders on a CPU (ANGLE (Mesa, Vulkan 1.4.354 (llvmpipe (LLVM 19.1.7 128 bits) (0x00000000)), llvmpipe))". The OpenGL ES display is never opened, as designed for a Vulkan device rejected as a CPU.
- `npm test` (task 5.4): after the fixes below, 432 pass and 7 skipped with no `OXGL_BACKEND`, and 434 pass and 5 skipped with `gpu`, none failing. The first run (429 and 430 passing, one failure each) surfaced two defects, neither specific to the OpenGL ES backend:
  - **Vulkan GPU and SwiftShader share one ANGLE display on Linux.** Both are opened with `EGL_PLATFORM_ANGLE_TYPE_VULKAN_ANGLE` and differ only in `EGL_PLATFORM_ANGLE_DEVICE_TYPE_ANGLE`, which ANGLE's platform display map leaves out of its key (`Display::GetDisplayFromNativeDisplay`). The first kind opened initializes the shared display. After a `'software'` context, `'gpu'` gets SwiftShader and is refused, WebGL 2 included, so the soak test's GPU probe skips. After a `'gpu'` context, `'software'` renders on V3DV. macOS and Windows open their GPU display on another platform type, and CI has no Vulkan GPU, so neither showed it. A distinct `EGL_PLATFORM_ANGLE_DISPLAY_KEY_ANGLE` per display kind separates them, but was reverted: the two kinds then become two Vulkan renderers in one process, which ANGLE doesn't support safely. Volk's function pointers are process-wide, and ANGLE reloads them for a renderer only in `ContextVk::onMakeCurrent` (`vk_renderer.cpp`: "Vulkan calls made through the function pointers are not synchronized"). In a `linux/arm64` container, two SwiftShader contexts, then `'auto'` (which probes lavapipe, rejects it, and falls back to SwiftShader), segfaulted. The backtrace runs `eglMakeCurrent` → `Context::initializeDefaultResources` → `ContextVk::initialize` → `vkCreateBuffer`, dispatched to lavapipe with SwiftShader's device. That is a context's first make-current, which initializes before `onMakeCurrent` reloads volk. ANGLE `main` is the same. Patching `initialize` would still leave concurrent use from two threads on different renderers unsafe. Resolved by "One Vulkan device per process on Linux" in Decisions.
  - `drawing-buffer-storage`'s "over the allocation budget" asks for 8192×8192, above `MAX_RENDERBUFFER_SIZE` on V3DV (7680) and V3D's GLES (4096), so it gets `INVALID_VALUE`. Fixed: the test now sizes the buffer from the limits, and skips where no allowed size exceeds the budget multisampled.

- Conformance and three.js (task 5.5), `OXGL_BACKEND=gpu`, so WebGL 2 runs on V3D through the OpenGL ES backend and WebGL 1 on V3DV through Vulkan. Each page is judged against the software expectations, so the list below is every page whose result differs from them, classified by cross-checking with llvmpipe (the `linux-x64-gles` run, task 6.3) and SwiftShader.
  - WebGL 2 on V3D (GLES): 2852 pass, 8 fail, 3 timeouts, 2 skipped, of 2865, on the final build (task 5.7).
    - ANGLE: none. `conformance2/reading/read-pixels-from-fbo-test.html` lost its context until `angle-8103.2`, which advertises a read format the driver accepts for `RGBA16UI`.
    - Fixed since that run: `ext-texture-norm16.html`, by disabling an ANGLE feature (see Decisions).
    - OpenGL ES backend, not yet diagnosed (also on llvmpipe): the timeouts of `khr-parallel-shader-compile.html` and both `offscreencanvas-transfer-image-bitmap.html` pages.
    - Fixed: `deqp/.../draw/random.html` (case 76) failed because its indices left `drawRangeElements`' range, and passes on V3D and llvmpipe now that the range is discarded.
    - V3D (passes on llvmpipe and SwiftShader): `deqp/.../fboinvalidate/default.html` (`render_depth_stencil`), `instanced-rendering-large-divisor.html`, `tex-srgb-mipmap.html` (sRGB mipmap generation), `transform_feedback/too-small-buffers.html`. That last one is a Mesa bug: two instanced draws in one transform feedback overlap, because the buffer position after the first advances by one vertex rather than one per instance. Plain Mesa gives `2 2 12 22 32` where llvmpipe gives `2 12 22 32 2 12 22 32`. The writes stay inside the checked size, so only the data is wrong, and oxgl has no cheap workaround.
    - Passing on V3D where SwiftShader fails: `unary_operator_00.html`.
  - WebGL 1 on V3D (GLES), on the final build: 966 pass, 2 fail, 2 timeouts, 1 skipped, of 971.
  - WebGL 1 on V3DV (Vulkan), before it moved: 963 pass, 6 fail, 1 crash. `sampler-array-using-loop-index.html` crashes the page's process (SIGSEGV), `gl-enable-enum-test.html` accepts `GL_MULTISAMPLE`, and `gl-max-texture-dimensions.html` fails because V3DV's limit, 7680, is not a power of two. The others are `ext-polygon-offset-clamp.html` and `webgl-compressed-texture-size-limit.html`. These are on the Vulkan path, which this change doesn't touch.
  - three.js (WebGL 2 on V3D): 282 pass, 72 fail, 23 skipped of 354. Most failures are small rasterization differences against the Chrome references. The largest are `webgl_read_float_buffer` (78%), `webgl_lightprobes` (63%) and `webgl_lightprobes_complex` (27%). `webgl_clipculldistance` fails because V3D lacks `WEBGL_clip_cull_distance`. `webxr_vr_panorama_depth` throws a type error in the runner's image upload. Not yet diagnosed individually.
- llvmpipe through the OpenGL ES backend (task 6.3) fails, besides those shared above, pages that pass on V3D, recorded as llvmpipe's in the expectations. Against `angle-8103.2` on `linux/amd64`, it matches them: WebGL 1 964 pass, 4 fail, 2 timeouts; WebGL 2 2849 pass, 10 fail, 3 timeouts, 1 crash; three.js 299 pass, 55 fail. `ext-color-buffer-half-float.html` passes: that release no longer sends WebGL 1's `copyTexImage2D` from a half-float framebuffer to the driver as a float-to-fixed-point copy, which the driver refuses (ES 3.0 §3.8.5).

- Without Mesa (task 5.3): `sudo apt-get remove libegl1 libegl-mesa0` also removed `libegl-dev` and `libgles-dev`, and `/usr/lib/aarch64-linux-gnu/libEGL.so.1` was gone. oxgl imported. WebGL 1 `'gpu'` rendered on V3DV, `'software'` rendered on SwiftShader (in a process of its own), and WebGL 2 `'gpu'` threw `OXGL_GPU_UNAVAILABLE`: "Vulkan: offers OpenGL ES 2.0 only; OpenGL ES: eglInitialize failed (EGL error 0x3001); the OpenGL ES backend needs the system's EGL driver (libEGL.so.1, from Mesa's libegl1 and libegl-mesa0)". WebGL 2 `'auto'` did not fall back to SwiftShader, contrary to this design: it threw `OXGL_CONTEXT_CREATION_FAILED`, ending "SwiftShader: eglChooseConfig failed (EGL error 0x3009)", because its SwiftShader display is the V3DV display it shares (Open Question 3), which has no ES 3 config. All four packages were reinstalled, and WebGL 2 `'gpu'` and `'auto'` render on V3D again.
- One Vulkan device per process (task 2.4), on the same Pi and build, before task 2.8 stopped the Pi's Vulkan display holding the device, so `'software'` now renders after `'gpu'` there. After `'gpu'` (V3DV), `'software'` throws `OXGL_CONTEXT_CREATION_FAILED` with "SwiftShader: the Vulkan GPU is in use, and a Linux process uses one Vulkan device". After `'software'`, `'gpu'` throws `OXGL_GPU_UNAVAILABLE` with "Vulkan: SwiftShader is in use, …" and `'auto'` renders on SwiftShader. `npm test` passes with no `OXGL_BACKEND` (435 pass, 6 skipped) and with `gpu` (once the new test's child process ran without the override), the GPU soak tests now running in a process of their own. Without Mesa's EGL, WebGL 2 `'auto'` throws `OXGL_CONTEXT_CREATION_FAILED` naming all three causes: Vulkan offers ES 2.0 only, the OpenGL ES backend needs `libEGL.so.1`, and the Vulkan GPU is in use. After reinstalling, it renders on V3D. In a `linux/arm64` container with `mesa-vulkan-drivers`, `'auto'` then `'software'` both render on SwiftShader, where before the change both rendered on lavapipe. `npm test` passes there (431 pass, 10 skipped), without a Vulkan driver (the same), and with `OXGL_BACKEND=gles` (430 pass, 11 skipped).
- Bench (task 5.6), `OXGL_BACKEND=gpu`, WebGL 2 on V3D's OpenGL ES backend beside WebGL 1 on V3DV:

  | Measure | GLES (WebGL 2) | Vulkan (WebGL 1) |
  |---|---|---|
  | enable/disable (calls/s) | 3,138,042 | 3,213,500 |
  | getError (calls/s) | 445,517 | 2,316,912 |
  | uniform4f (calls/s) | 1,909,939 | 2,183,780 |
  | drawArrays, 1 small triangle (draws/s) | 622,661 | 669,397 |
  | bufferSubData 24 B + drawArrays (pairs/s) | 97,263 | 253,964 |
  | textured full-screen draw, NEAREST (Mpixels/s) | 3,979 | 4,009 |
  | textured full-screen draw, LINEAR (Mpixels/s) | 3,397 | 3,412 |
  | bufferSubData 1 MiB (MB/s) | 12,157 | 10,344 |
  | texSubImage2D 512×512 RGBA8 (MB/s) | 5,377 | 5,923 |
  | readPixels 256×256 RGBA8 (MB/s) | 634 | 691 |
  | three.js 1000 meshes (frames/s) | 87.9 | (WebGL 2 only) |
  | three.js 1 mesh, 128×64 segments (frames/s) | 9,368 | (WebGL 2 only) |

  WebGL 1 on GLES, on the final build (`--webgl1`), is close to WebGL 2's column, so moving it from Vulkan costs what that column shows: `getError` 345,202 calls/s against 2,316,912, and `bufferSubData` 24 B + `drawArrays` 88,016 pairs/s against 253,964. The other measures are within 15%.

  Most calls are within 15%. `getError` is 5× slower on GLES, which suggests ANGLE's GL backend asks the driver each time, and small `bufferSubData`-then-draw pairs are 2.6× slower.

## Open Questions

1. CI cost: run conformance and three.js on `gles` in every full run (as designed), or only the Node tests, with conformance run by hand?
3. ~~Linux GPU and SwiftShader in one process~~: resolved as option (a) in Decisions, "One Vulkan device per process on Linux". Option (b), an ANGLE patch so two Vulkan renderers coexist, was turned down: it is a large upstream patch whose thread safety would need proving, for a mix few processes need. Option (c), documenting only, left the wrong-device results silent.
2. ~~CI redesign~~: resolved. The merge-queue CI landed first, and the `gles` job moved into it as a full-only job.
