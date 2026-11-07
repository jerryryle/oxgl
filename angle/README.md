# ANGLE bundles

oxgl renders through [ANGLE](https://chromium.googlesource.com/angle/angle),
with SwiftShader as the software fallback. Google publishes no ANGLE binaries,
so oxgl builds its own in a separate repository,
[oxgl-js/oxgl-angle](https://github.com/oxgl-js/oxgl-angle), which holds the
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
| `scripts/bump.py` | Pins an oxgl-angle release (the given tag, or the latest) in `bundles.toml` from its `SHA256SUMS`, after checking that oxgl-angle's own workflows made it |
| `scripts/bump.sh` | The automatic bump: `bump.py`, then the patch version bump |
| `scripts/test_bump.py` | Tests `bump.py`'s origin check and rewrite |

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

1. In [oxgl-angle](https://github.com/oxgl-js/oxgl-angle), change the recipe
   with a new `bundle_version` and land it through its merge queue, which
   builds the bundles; the push to its `main` releases them (its
   `angle/README.md` has the steps). oxgl-angle also does this by itself for
   each new Chrome stable release.
2. oxgl-angle's release job then starts `.github/workflows/angle-bump.yml`
   here:
   - It runs `angle/scripts/bump.sh`, which pins the release's bundles and
     digests and bumps the patch version.
   - It opens or refreshes a pull request from the `angle-bump` branch, as the
     `oxgl-js` GitHub App, with auto-merge on.
   - The merge queue runs the full checks against the new bundles and lands
     it, and the push to `main` publishes the new version to npm.

   A bump whose queue run fails leaves the queue and stays open for a person
   to push a fix to `angle-bump`; it then lands through the queue. To skip a
   release, label its pull request `skip-bump` and close it. The bump refuses
   a release that oxgl-angle's own workflows didn't make (created and every
   asset uploaded by `github-actions[bot]`, tag on oxgl-angle's `main`). It
   also runs on every push to `main` and by hand (Actions → angle-bump → Run
   workflow), rebuilding an open bump only when it went stale.
   To pin by hand instead, run `angle/scripts/bump.sh [<tag>]` and open a PR.
   After an ANGLE update, also recheck the known upstream issues below.

To try a locally built bundle first, point the build at it:
`OXGL_ANGLE_DIR=<extracted bundle> npm run build`.

### Known upstream issues

ANGLE behavior oxgl does not work around, listed so that every ANGLE update
rechecks it.

#### Conformance failures

Khronos conformance pages that fail because of ANGLE, or of the SwiftShader it
bundles. Each is an expected failure in
`conformance/expectations.txt`, tagged `ANGLE:` or `SwiftShader:`. Last checked
against `angle_commit` `127e783de334` (`chromium/8078`); on `751417514a52`
(`chromium/8103`), only through the OpenGL ES backend.

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

#### three.js example differences

three.js examples (`npm run threejs`) that render differently because of the
SwiftShader in the bundle. Each is an expected failure in
`threejs/expectations.txt`, tagged `SwiftShader:`. Last checked against
`angle_commit` `127e783de334`.

| Examples | Cause | Repro |
| --- | --- | --- |
| `webxr_xr_dragging`, `webxr_xr_dragging_custom_depth` | SwiftShader gets the depth wrong on a large triangle that the near plane clips: the examples' floor, two triangles whose near edge passes under the camera, hides the objects standing on it. On macOS arm64 they raise no GL errors under SwiftShader, render correctly once the floor is subdivided, and match the reference exactly on ANGLE Metal; the repro shows the same depth error on Linux arm64. | Through three.js on oxgl: a `PerspectiveCamera(50, 1.6, 0.1, 10)` at (0, 1.6, 3), an opaque `PlaneGeometry(6, 6)` rotated to the ground, and 0.4-unit boxes on it at z = −0.5 to −1.5. At 200×125 with `OXGL_BACKEND=software`, SwiftShader shows 39 red pixels of the boxes on Linux arm64, and 783 when the plane is `PlaneGeometry(6, 6, 32, 32)`; macOS arm64 gives the same counts, and ANGLE Metal shows 782 either way. |

After changing `angle_commit`, run `npm run threejs -- --filter webxr_xr_dragging`.
An example that now passes is reported as an unexpected pass: remove its
expectation, this row, and the near-clipped triangle entry in oxgl's README
"Known issues".

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

### Upstream issues oxgl works around

Each has a report ready to file in `angle/upstream-reports.md`.

Defects oxgl avoids, listed so that an ANGLE or Mesa update can remove the
workaround.

| Defect | Workaround | Where |
| --- | --- | --- |
| On the OpenGL ES backend, ANGLE passes WebGL 1's `generateMipmap` on an unsized float texture to the driver, which refuses it without linear float filtering, or for `RGB` even with it, and the error loses the context. | `Context::generate_mipmap` generates `INVALID_OPERATION` | ANGLE: `ValidateGenerateMipmapBase`, `src/libANGLE/validationES.cpp` |
| ANGLE's OpenGL ES backend passes `drawRangeElements`' range to the driver, which may trust it. llvmpipe reads outside its vertex data when an index is outside the range. | oxgl calls `drawElements`, as WebGL 2.0, "Writing to the drawing buffer", allows | ANGLE: `ContextGL::drawRangeElements`, `src/libANGLE/renderer/gl/ContextGL.cpp` |
| ANGLE's OpenGL ES backend reads `RG16` as `RG`/`UNSIGNED_SHORT` under `readPixelsUsingImplementationColorReadFormatForNorm16`, which Mesa refuses, since its own read format is `RGBA`, and the error loses the context. | The OpenGL ES display disables the feature | ANGLE: `GetReadPixelsFormat`, `src/libANGLE/renderer/gl/formatutilsgl.cpp` |
| ANGLE's Metal backend shares a command queue and an unlocked state cache across a display's contexts, so threads on one display read stale pixels and can crash the process. | Each thread uses its own display, from a pool of native display keys | `Display::for_this_thread`; ANGLE: `mtl::CommandQueue`, `mtl::StateCache` |
| V3D's multisample resolve doesn't wait for queued draws that read its destination, so they sample the new contents. | `Context::blit_framebuffer` flushes first on the OpenGL ES backend | Mesa: `v3d_blit` |
| V3D can lose a color buffer frames after it is invalidated. | `Context::invalidate_framebuffer` drops valid color attachments on the OpenGL ES backend | Mesa: `v3d_invalidate_resource` |
| V3D applies a divisor above 65535 as 65535, with no bound on the fetch. | `instanced_draw_out_of_range` range-checks draws of more than 65535 instances, with the divisor V3D applies | Mesa: `v3dx_state.c` |
| V3D filters sRGB mipmaps in encoded space. | The OpenGL ES display enables `decodeEncodeSRGBForGenerateMipmap`, for 2D textures | Mesa, `GLES_ENABLED_FEATURES` in `crates/oxgl-sys/src/egl.rs` |
| Mesa compiles synchronously, so `KHR_parallel_shader_compile` offers nothing, and its page's shader sizing never stops. | The OpenGL ES display enables `disableNativeParallelCompile` | ANGLE, `GLES_ENABLED_FEATURES` |
| Mesa before 26 writes blit destinations from outside the source. | The OpenGL ES display enables `clipSrcRegionForBlitFramebuffer` | Mesa, `GLES_ENABLED_FEATURES` |
| llvmpipe clips with clip distances even after they're disabled. | The OpenGL ES display enables `emulateClipDistanceState` | Mesa, `GLES_ENABLED_FEATURES` |
| ANGLE emits a dynamic sampler array index on a device with `shaderSampledImageArrayDynamicIndexing = false`, and V3DV keeps one descriptor for the array, so a WebGL 1 loop over a sampler array segfaults at the draw. | On a Vulkan GPU with OpenGL ES 2.0 only, no context uses Vulkan: `Backends::opened` refuses the display, and the OpenGL ES backend or SwiftShader serves it | Mesa: `lower_tex_src`, `src/broadcom/vulkan/v3dv_pipeline.c` |
