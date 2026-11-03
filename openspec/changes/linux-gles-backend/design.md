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
- No change on machines where Vulkan already serves the request, and no new runtime dependency anywhere.
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

**The trigger: a hardware Vulkan display with no ES 3.0 config.** For a WebGL 2 request on Linux, the GPU candidates are:
1. Vulkan, as today.
2. The OpenGL ES backend, tried only when the Vulkan display opened, passed the CPU-renderer check, and offers no `EGL_OPENGL_ES3_BIT` config.

ANGLE exposes no ES 3 config when `getMaxSupportedESVersion` is below 3.0, which is what makes today's `eglChooseConfig` fail with oxgl's `EGL_BAD_MATCH` (0x3009). Whether a display offers ES 3.0 is a fixed property of that display, so it is computed once when the display opens and stored in its slot. A Vulkan ES 3 context that fails for another reason (out of memory) still fails only that call and doesn't divert to GL. When Vulkan fails or is rejected as a CPU, behaviour is unchanged: `'gpu'` throws, `'auto'` uses SwiftShader. If GL were tried in those cases, every GPU-less Linux machine with Mesa installed, CI runners included, would load Mesa and llvmpipe into the process just to reject them. That load also brings Mesa into the ASan job.

**The OpenGL ES display.** `DisplayKind::Gles` (Linux only) opens `EGL_PLATFORM_ANGLE_TYPE_ANGLE = EGL_PLATFORM_ANGLE_TYPE_OPENGLES_ANGLE` with `EGL_PLATFORM_ANGLE_NATIVE_PLATFORM_TYPE_ANGLE = EGL_PLATFORM_SURFACELESS_MESA`. `create_context`, `choose_config` and the context attributes are unchanged: ANGLE's front end implements WebGL compatibility, robust resource initialization, robust access and lose-on-reset for every backend. The GL backend asks Mesa for robustness through `EGL_EXT_create_context_robustness`, which Mesa has. It goes in its own slot, `gles`, in `Backends`, with the same failure memory as the others (the existing accepted trade-off covers it).

**The CPU-renderer check covers the OpenGL ES display.** The `GL_RENDERER` check that runs on the GPU display runs on the GLES display too. `CPU_RENDERERS`, which already holds `"llvmpipe"` and `"softpipe"`, gains `"swrast"` and `"software rasterizer"`. In a WebGL context ANGLE builds `GL_RENDERER` as `ANGLE (<vendor>, <renderer>, <version>)`, stripping commas from each part and cutting the version to its number (`Context::initRendererString`, `SanitizeVersionString` in `DisplayGL.cpp`). It reads `ANGLE (Mesa, llvmpipe (LLVM 19.1.7 128 bits), OpenGL ES 3.2)` on llvmpipe and `ANGLE (Broadcom, V3D 7.1.10.2, OpenGL ES 3.1)` on the Pi (read from the source, confirmed in tasks 3.2 and 5.1), and the `llvmpipe` substring matches. The check is skipped only in `test-gles` mode.

**Messages.** `'gpu'` on a WebGL 2 request that reaches GL and fails reports both attempts: `OXGL_GPU_UNAVAILABLE`, "Vulkan: offers OpenGL ES 2.0 only; OpenGL ES: the GPU backend renders on a CPU (ANGLE (Mesa, llvmpipe …))". Without Mesa the second part is `eglInitialize failed (EGL error 0x3001)`, since EGL reports only a code and ANGLE's reason stays in its log, followed by a note that the backend needs the system's EGL driver (`libEGL.so.1`, from Mesa's `libegl1` and `libegl-mesa0`). `'auto'` adds SwiftShader's cause only when everything fails, as today.

**`Backend` stays two-valued for JavaScript.** The `backend` option keeps its values `'auto'`, `'gpu'` and `'software'`. The concrete display (`Vulkan`, `OpenGL ES`) is internal and shows only in messages and `GL_RENDERER`. In the test-only `gles` mode, `createContext` passes `gles` to the native side and records it with the context's other creation parameters, so a restore after a context loss opens the GLES display again. The report's `backend` field (`OXGL_BACKEND`) says `gles`.

**Test-only mode: Cargo feature `test-gles`.** On `oxgl-node` only. `oxgl-core` always has `RequestedBackend::Gles`, an internal Rust API, so its selection tests run on every platform; only the Node binding's mapping of the `gles` string is gated. With the feature:
- the native module exports `testBackends = ['gles']`;
- `resolveBackend` in `src/context.ts` accepts `OXGL_BACKEND=gles` only when that export lists it, and otherwise rejects it as `OXGL_INVALID_BACKEND` as it does any unknown value;
- `gles` makes every request, WebGL 1 and 2, use the GLES display only, with no CPU-renderer check and no fallback.

The feature compiles on every platform, so `cargo clippy --all-features` works everywhere. Its code is `cfg!(all(feature = "test-gles", target_os = "linux"))`. Elsewhere it does nothing and `testBackends` is empty, so `gles` stays invalid there. `DisplayKind::Gles` is `cfg(target_os = "linux")`; elsewhere `AngleProbe` refuses `Backend::Gles` with an error. `testBackends` is a new native export, so the native ABI version goes to 15.

Release builds and packages never enable the feature, so their `'gpu'` can't accept a CPU. Alternatives considered:
- An environment variable in the release binary: exposes the CPU path publicly.
- Rust-only integration tests: miss the JavaScript-level WebGL behaviour that requirement 5 of the brief asks to verify.

**Expectations target `linux-x64-gles`.** `PLATFORMS` in `conformance/expectations.mjs` gains `linux-x64-gles`, last. The conformance and three.js runners already create contexts with no `backend` option and record `OXGL_BACKEND` in their reports, so the override reaches every page unchanged. `scripts/results-page.mjs` builds its columns from `PLATFORMS`, so the page gains a linux-x64-gles column with no code change beyond the spec's order. The host target is `linux-x64-gles` when `OXGL_BACKEND=gles`, and the platform name otherwise. An entry without platforms still applies to every target, so the shared entries (ANGLE's `__` identifiers, the JS-engine page) apply to `gles` with no edit. An update run on `gles` narrows entries as it does for any platform. The three.js runner imports the same list.

**CI.** Within "Each platform is built once per run", the Linux x64 build job also builds the addon with `--features test-gles`, after it has packed the release packages and into a separate directory (`napi build --output-dir dist-gles`), so the packed `dist/oxgl.linux-x64-gnu.node` is never overwritten. It uploads that addon as `addon-linux-x64-gles`, never packed or released. The job's existing pack check confirms the packed addon rejects `gles`. A new `gles` job on `ubuntu-24.04`:
1. installs `libegl1 libegl-mesa0 libgl1-mesa-dri`;
2. unpacks the run's Linux x64 packages, then replaces the addon with the `test-gles` one;
3. runs `npm test`, both conformance suites and the three.js examples with `OXGL_BACKEND=gles`.

The aggregate `ci` check requires it. The job adds one Linux x64 copy of the long suites to every full run. The alternative, Node tests only on GLES, keeps CI shorter but leaves conformance on this backend to manual runs. This is open question 1.

**Bench.** `bench/run.mjs` accepts `--webgl1`, which creates its contexts with `webgl2: false`. The default stays WebGL 2.

**ANGLE recipe (oxgl-angle).**
- `angle_enable_gl` moves out of `common.gn`: `true` in both Linux files, `false` in the macOS and Windows files.
- `angle_enable_gl_desktop_backend = false` on Linux. It drops desktop GL support, which oxgl never selects; the GLES-on-EGL path builds and runs without it (below).
- `angle_use_x11`, `angle_use_wayland` stay `false`; `angle_use_gbm` stays at its default `false`.
- `bundle.py` requires `angle_enable_gl = true` on Linux. It fails if a Linux library has a `NEEDED` entry for `libEGL.so.1`, `libGL`, `libGLESv2.so.2`, `libgbm` or `libdrm`, or exports `drm*` symbols.
- `smoke.c` is unchanged, since it renders with SwiftShader. The build host has no Mesa, so loading the bundle and rendering there also shows the GL backend adds no load-time dependency.
- New `bundle_version` `angle-8078.8`. oxgl's `angle/bundles.toml` follows in this change.
- A source patch, `angle-gles-rgb8-implementation-read-format.patch`, in `angle-8078.9` and every release after it (oxgl now pins `angle-8103.1`). ANGLE's OpenGL backend advertised `RGB`/`UNSIGNED_BYTE` as the implementation read format of an `RGB8` color buffer and passed an `RGB` read to the driver unchanged. An OpenGL ES driver need accept only `RGBA`/`UNSIGNED_BYTE` and its own chosen pair (ES 3.0.6 §4.3.2), and Mesa chooses `RGBA` for `RGB8`, so it rejected the read; in a WebGL context ANGLE turns that driver error into a context loss (`loseHardenedContextOnBackendError`). Every `alpha: false` context lost its context on a `readPixels` in the advertised format, on llvmpipe and on the Pi's V3D. With the patch, ANGLE advertises `RGBA` for `RGB8` over an OpenGL ES driver and refuses an `RGB` read itself with `INVALID_OPERATION`. The alternative, a read-and-convert path in oxgl, would have to handle pack parameters and pixel pack buffers, and would cover only reads that go through oxgl's checks.

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
- Unsafe confinement: the new display kind is another attribute list for `eglGetPlatformDisplayEXT`, inside `oxgl-sys` under the existing `// SAFETY:` comment; `supports_es3` reuses `choose_config`. No new FFI functions, and no unsafe outside `oxgl-sys`.
- No panics: new paths return `Result`/`String` errors like the existing ones.
- Handle model and ArrayBuffer lifetime: untouched. Contexts on the new display are ordinary `GlContext`s, with the same thread affinity and drop order.

## Risks / Trade-offs

- **Mesa in the process** → loaded only on the trigger above. Mesa's llvmpipe or V3D screen, and any threads it starts, live until exit because displays are never terminated. That is the existing display model, and it doesn't grow with contexts (task 4.3 checks that repeated contexts don't grow the thread count or memory).
- **Exit with a live Mesa display** → a process that used GL exits through Node's normal teardown. Task 4.3 checks that this doesn't crash, on the Pi and in the CI job.
- **Two drivers for one GPU** → on the Pi, WebGL 1 renders through V3DV (Vulkan) and WebGL 2 through V3D (GL) in the same process. Both are the same GPU, and WebGL contexts share nothing, so nothing observable depends on it beyond `GL_RENDERER`.
- **llvmpipe GL results stand in for V3D in CI** → CI proves oxgl's GL code path, not V3D. The Pi runs are recorded here and in the README.

## Accepted trade-offs

- A machine whose Vulkan driver gives ES 2.0 and whose GL driver fails once at initialization keeps failing (`'gpu'`) or using SwiftShader (`'auto'`) for WebGL 2 until restart. The existing "GPU initialization failure is remembered" trade-off, extended to the third display.

## Results on the Pi

Filled in by tasks 5.x: renderer string, attributes and bits, the refused CPU renderer, every failing conformance page and three.js example with its reason and whether V3D or oxgl is at fault, and `npm run bench` on GLES (WebGL 2) beside Vulkan (`--webgl1`).

## Open Questions

1. CI cost: run conformance and three.js on `gles` in every full run (as designed), or only the Node tests, with conformance run by hand?
2. CI redesign: the `gles` job is added to today's `ci.yml`. If the redesign lands first, the job moves into it unchanged.
