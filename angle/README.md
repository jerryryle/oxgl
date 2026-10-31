# ANGLE bundles

oxgl renders through [ANGLE](https://chromium.googlesource.com/angle/angle),
with SwiftShader as the software fallback. Google publishes no ANGLE binaries,
so oxgl builds its own in a separate repository,
[jerryryle/oxgl-angle](https://github.com/jerryryle/oxgl-angle), which holds the
build recipe and publishes the bundles as its releases. This repository only
pins them: developers, CI and npm builds download the bundles named in
`bundles.toml` and verify them against the digests committed there, so ANGLE
is never built here.

Bundles are built for five platforms: `linux-x64`, `linux-arm64`,
`macos-arm64`, `windows-x64` and `windows-arm64`. oxgl itself currently
supports only Linux arm64 (see the top-level README).

## Files

| File | Purpose |
|---|---|
| `bundles.toml` | The pinned bundles: `bundle_version` (the oxgl-angle release) and per-platform bundle URL + sha256 that oxgl-sys downloads, and optionally a symbols archive (`symbols_url`, `symbols_sha256`) that it uses instead of the stripped libraries when `OXGL_ANGLE_SYMBOLS` is set |
| `scripts/check_pin.py` | Validates `bundles.toml`, including that every URL is in the named oxgl-angle release |

## Bundle layout

```
lib/        libEGL, libGLESv2, SwiftShader Vulkan ICD + vk_swiftshader_icd.json (stripped)
include/    EGL, GLES2, GLES3, KHR headers, including ANGLE extension headers
licenses/   license texts of ANGLE and every linked third_party component
BUILD_INFO.json   commit, GN args, toolchain, components with SPDX licenses, file digests
```

Bundles are `angle-<platform>.tar.xz`; unstripped libraries are in
`angle-<platform>-symbols.tar.xz`.

oxgl-angle's `bundle.py` fails the bundle build if a required library or the ICD manifest is
missing, a required backend is not enabled, a linked component's license is
missing or not on its copy of the `deny.toml` allowlist, or (Linux) a library links
X11/xcb/Wayland or needs glibc newer than 2.31. On Linux arm64 it also fails
if any library has a `LOAD` segment aligned below 64 KiB: arm64 kernels use 4,
16 or 64 KiB pages, and only 64 KiB alignment loads under all of them. The
smallest alignment is recorded in `BUILD_INFO.json` as `min_load_align`.
The GN-arg and license checks also run right after `gn gen`
(`bundle.py --preflight`), so they fail before the compile rather than after it.

## How oxgl-sys finds a bundle

`crates/oxgl-sys/build.rs` uses, in order:

1. `OXGL_ANGLE_DIR`: an extracted bundle directory (offline builds, or testing a
   local ANGLE build). The build prints a warning while this is set.
2. The cache: `$OXGL_ANGLE_CACHE`, default `~/.cargo/oxgl-angle/<sha256>/`.
3. A download of the URL in `bundles.toml` with `curl`, verified against its
   sha256 before anything is extracted. A mismatch fails the build.

`npm run build` then copies the bundle's `lib/` to `dist/angle/` next to the
addon and writes `dist/THIRD_PARTY_NOTICES` with the ANGLE license texts.

`build.rs` also re-checks the bundle's component licenses (from
`BUILD_INFO.json`) against today's `deny.toml` allowlist and fails if one is no
longer allowed: narrowing the allowlist needs a bundle built under it (see
Changing ANGLE), or the change reverted. This `deny.toml` is authoritative;
oxgl-angle keeps a copy for its own build.

## Changing ANGLE

ANGLE changes in two steps, one in each repository:

1. In [oxgl-angle](https://github.com/jerryryle/oxgl-angle), change the recipe
   with a new `bundle_version`, merge it, and release it (its
   `angle/README.md` has the steps). The release run prints the digests.
2. Here, copy each platform's URL and sha256, and the `bundle_version`, into
   `bundles.toml`, run `python3 angle/scripts/check_pin.py`, and open a PR. CI
   builds and tests oxgl against the new bundles. After an ANGLE update, also
   recheck the known upstream issues below.

To try a locally built bundle first, point the build at it:
`OXGL_ANGLE_DIR=<extracted bundle> npm run build`.

### Known upstream issues

ANGLE behavior oxgl does not work around, listed so that every ANGLE update
rechecks it.

#### Conformance failures

Khronos conformance pages that fail because of ANGLE, or of the SwiftShader it
bundles. Each is an expected failure in
`conformance/expectations.txt`, tagged `ANGLE:` or `SwiftShader:`. Last checked
against `angle_commit` `127e783de334` (`chromium/8078`).

| Page (suites) | Cause | Where |
| --- | --- | --- |
| `conformance/glsl/misc/shader-with-double-underscore.html` (webgl1, webgl2) | ANGLE rejects identifiers containing `__` in WebGL shaders; the test expects them to compile, as newer GLSL ES allows. Still so on ANGLE `main` (October 2026). | `TParseContext::checkIsNotReserved`, `src/compiler/translator/ParseContext.cpp` |
| `conformance2/textures/misc/immutable-tex-render-feedback.html` (webgl2) | A mutable texture's level is attached while its range is empty (`TEXTURE_BASE_LEVEL` 1, `TEXTURE_MAX_LEVEL` 0); ANGLE reports the framebuffer complete instead of `FRAMEBUFFER_INCOMPLETE_ATTACHMENT` (OpenGL ES 3.0 §4.4.4). Fails on Metal too. | ANGLE's framebuffer completeness checks |
| `deqp/functional/gles3/shaderoperator/unary_operator_00.html` (webgl2) | SwiftShader fails `shaderop.unary_operator.minus.lowp_uint_vertex`. Passes on GPU backends. | SwiftShader |

After changing `angle_commit`, run the full suite (`npm run conformance`) with
the new bundle. A page here that now passes is reported as `expected FAIL, got
PASS`, which fails the run: remove its expectation (`--update`) and its row,
and update the commit above. To check one page,
`npm run conformance -- --filter <page>`.

#### Runtime issues

ANGLE behavior that oxgl's README documents under "Known issues". Last checked
against `angle_commit` `127e783de334`; still present on `chromium/8127` and
`main` (October 2026).

| Issue | Cause | Where | When it is fixed |
| --- | --- | --- | --- |
| SwiftShader initialization briefly changes process-global state (`VK_ICD_FILENAMES`, and the working directory on Linux and Windows) | ANGLE points the Vulkan loader at SwiftShader's ICD through the environment and working directory | `angle::vk::ScopedVkLoaderEnvironment`, used in `src/libANGLE/renderer/vulkan/vk_renderer.cpp` | Remove the entry from oxgl's README "Known issues" |
| Each thread that uses EGL leaves 72 bytes behind | ANGLE allocates each thread's `egl::Thread` and Display TLS data on its first EGL call and never frees them ("Global thread intentionally leaked") | `src/libGLESv2/global_state.cpp`, `egl::GetCurrentThread` | Remove the README "Known issues" entry and the `leak:egl::GetCurrentThread` line in `.github/lsan-suppressions.txt` |

After changing `angle_commit`, check that the code above is still in the new
commit's sources. For the leak, also run the `asan` job without its
suppression: it reports the 72-byte allocations for as long as ANGLE makes them.
