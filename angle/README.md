# ANGLE bundles

oxgl renders through [ANGLE](https://chromium.googlesource.com/angle/angle),
with SwiftShader as the software fallback. Google publishes no ANGLE binaries,
so oxgl builds its own from a pinned revision and publishes them as GitHub
release assets. Everything else (developers, CI, npm builds) downloads those
bundles and verifies them against digests committed here.

## Files

| File | Purpose |
|---|---|
| `pin.toml` | ANGLE commit, depot_tools commit, release tag, and per-platform bundle URL + sha256 |
| `args/*.gn` | GN build arguments: `common.gn` plus one file per platform |
| `args/targets.txt` | Ninja targets to build |
| `build.sh`, `build.ps1` | Build recipe (`fetch`, `build`, `bundle`, `all`) for macOS/Linux and Windows |
| `scripts/bundle.py` | Assembles the bundle and enforces the outcome checks |
| `scripts/check_pin.py` | Validates `pin.toml` |
| `licenses.toml` | SPDX licenses for third_party directories lacking `README.chromium` metadata |
| `smoke/smoke.c` | Loads a bundle, renders one frame with SwiftShader, reads a pixel back |

## Bundle layout

```
lib/        libEGL, libGLESv2, SwiftShader Vulkan ICD + vk_swiftshader_icd.json (stripped)
include/    EGL, GLES2, GLES3, KHR headers, including ANGLE extension headers
licenses/   license texts of ANGLE and every linked third_party component
BUILD_INFO.json   commit, GN args, toolchain, components with SPDX licenses, file digests
```

Bundles are `angle-<platform>.tar.xz`; unstripped libraries are in
`angle-<platform>-symbols.tar.xz`.

`bundle.py` fails the build if a required library or the ICD manifest is
missing, a required backend is not enabled, a linked component's license is
missing or not on the allowlist in `deny.toml`, or (Linux) a library links
X11/xcb/Wayland or needs glibc newer than 2.31.
The GN-arg and license checks also run right after `gn gen`
(`bundle.py --preflight`), so they fail before the compile rather than after it.

## How oxgl-sys finds a bundle

`crates/oxgl-sys/build.rs` uses, in order:

1. `OXGL_ANGLE_DIR`: an extracted bundle directory (offline builds, or testing a
   local ANGLE build). The build prints a warning while this is set.
2. The cache: `$OXGL_ANGLE_CACHE`, default `~/.cargo/oxgl-angle/<sha256>/`.
3. A download of the pinned URL with `curl`, verified against the pinned sha256
   before anything is extracted. A mismatch fails the build.

`npm run build` then copies the bundle's `lib/` to `dist/angle/` next to the
addon and writes `dist/THIRD_PARTY_NOTICES` with the ANGLE license texts.

## Building locally

Needs Git, Python 3.11+, and the platform toolchain: on macOS, full Xcode plus
its Metal Toolchain component (`xcodebuild -downloadComponent MetalToolchain`);
on Windows, Visual Studio 2022 with the Windows SDK. `build.sh` selects
`/Applications/Xcode.app` through `DEVELOPER_DIR` for the build only. The checkout and build
need about 20 GB in `$OXGL_ANGLE_WORK` (default `~/.cache/oxgl/angle-build`).

```sh
angle/build.sh all macos-arm64          # or linux-x64; Windows: pwsh angle/build.ps1 all
cc -I ~/.cache/oxgl/angle-build/dist/angle-macos-arm64/include angle/smoke/smoke.c -o smoke
./smoke ~/.cache/oxgl/angle-build/dist/angle-macos-arm64/lib
OXGL_ANGLE_DIR=~/.cache/oxgl/angle-build/dist/angle-macos-arm64 npm run build
```

## Measured sizes

| Platform | Checkout + build tree | Bundle (`.tar.xz`) | Unpacked `lib/` |
|---|---|---|---|
| macos-arm64 (M-series, 16 cores) | ~13 GB | to re-measure without WebGPU (was 7.6 MB) | to re-measure (was 28 MB) |
| linux-x64 | first `angle-build` run | | |
| windows-x64 | first `angle-build` run | | |

## Updating ANGLE

1. Pick the ANGLE commit Chrome stable ships (chromiumdash.appspot.com lists it
   under the release's hashes) and set `angle_commit`, `chromium_branch`, and a
   new `bundle_version` in `pin.toml`. Optionally bump `depot_tools_commit`.
2. Open a PR with the pin change: `angle-build` runs automatically and builds,
   checks and smoke-tests all three platforms. After it merges, run
   `angle-build` by hand from `main` (Actions → angle-build → Run workflow); that
   run creates a draft release named after `bundle_version`, with the digests
   in its summary.
3. Copy each platform's URL and sha256 into `pin.toml`, run
   `python3 angle/scripts/check_pin.py`, and open a PR; CI builds against the
   new bundles.
4. Publish the draft release when the PR merges.

A deleted release asset is rebuilt by re-running the workflow at the same pin.
