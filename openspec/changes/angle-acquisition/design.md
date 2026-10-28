# Design

## Context

See proposal.md for motivation. Constraints that shape the choice:

- Google publishes **no ANGLE release binaries**. ANGLE is built with Chromium's toolchain: depot_tools (`gclient`, `gn`, `ninja`/`autoninja`), a hermetic Clang downloaded by `gclient sync`, Visual Studio + Windows SDK on Windows (`DEPOT_TOOLS_WIN_TOOLCHAIN=0` outside Google), Xcode on macOS, and `build/install-build-deps.sh` plus a Debian sysroot on Linux.
- SwiftShader is reached through ANGLE's **Vulkan backend** using the SwiftShader Vulkan ICD (`vk_swiftshader`), selected with `EGL_PLATFORM_ANGLE_TYPE_VULKAN_ANGLE` + `EGL_PLATFORM_ANGLE_DEVICE_TYPE_SWIFTSHADER_ANGLE`. So every platform, including macOS and Windows, needs the Vulkan backend compiled in, not only Linux.
- Linux libraries must not need X11/Wayland (headless requirement). Chromium-configured builds may link display libraries unless configured otherwise.
- Releases must keep pace with ANGLE security fixes; ANGLE parses untrusted shader source.

## Options Compared

**A. Build from source with depot_tools (in our CI, results published as our own artifacts).**
**B. Vendor third-party prebuilt binaries** — realistically: libraries extracted from Electron or Chromium distributions (they ship `libEGL`, `libGLESv2`, and `vk_swiftshader` on all three platforms), or package-manager ports (vcpkg, conda-forge, Homebrew) or community wheels/packages.

Figures below are planning estimates for GitHub-hosted standard runners; task 1.2 measures the real numbers on the first build and records them in `angle/README.md`.

| Criterion | A. Build from source | B. Vendor third-party prebuilts |
|---|---|---|
| **Build time** | `gclient sync`: ~10-25 min, several GB of checkout. Release build of `libEGL` + `libGLESv2` + `vk_swiftshader` (targets only, not tests): ~40-90 min per platform on a 4-vCPU runner; ~15-30 min on a 16-core larger runner. Incremental cache is rarely useful because pins move weeks apart. | Minutes (download + extract). |
| **CI cost** | Only when the pin changes, not per PR. ~12-15 rebuilds/year × 3 platforms ≈ 40-50 jobs/yr, ~1-1.5 h each. Free on public repos; on private repos macOS minutes are the dominant cost (10× multiplier). Regular CI downloads a ~15-40 MB artifact. | Same per-PR download cost; no rebuild cost. |
| **Binary size** | Under our control: release, symbols stripped (separate debug-symbol archive), only needed backends. Estimated ~20-35 MB uncompressed per platform (GLESv2 + SwiftShader dominate). | Fixed by upstream config: includes backends and features we don't use; no say over symbols or size. Electron/Chromium builds do not always ship headers. |
| **Configuration control** | Full: can disable X11/Wayland on Linux, enable exactly Vulkan+SwiftShader+Metal/D3D11, set `is_component_build=false`, add ASan variants later, carry a patch if ever needed. | None. Linux Chromium/Electron builds are configured for a desktop browser and may depend on display libraries, violating the headless requirement. Can't add sanitizer builds. |
| **Update cadence** | Our choice. Track Chromium stable branches (`chromium/NNNN`, every 4 weeks) and rebuild on security fixes; a pin bump is a small reviewed PR. | Bound to the upstream product's release train. Electron gives a clean version mapping; package-manager ports lag months and often omit Vulkan/SwiftShader or a platform. |
| **Reproducibility & provenance** | Source commit + DEPS-pinned hermetic toolchain + recorded GN args → functionally reproducible (not guaranteed bit-identical). Provenance is our own CI; can attach build attestations. | Provenance is someone else's binary. Version reproducible only as long as upstream keeps hosting it. Licensing: Chrome binaries carry Chrome's terms; Electron/Chromium are open source but redistributing extracted pieces needs care with notices. |
| **Coverage of all 3 platforms with SwiftShader** | Yes, by construction. | Electron/Chromium: yes, but without headers or our config. Ports: inconsistent. |
| **Maintenance burden** | Real: depot_tools/GN breakages on runner image updates, Windows SDK/VS version drift, occasional DEPS churn. Mitigated because it only runs on pin bumps. | Low until upstream changes layout or drops a file; then blocked with no recourse. |

## Recommendation

**Option A, delivered as prebuilt artifacts (a hybrid):** build ANGLE from source in a dedicated `angle-build` workflow that runs only when the build recipe changes, publish the per-platform bundles as release assets on the oxgl GitHub repo, and have everything else (developers, regular CI, the npm release) consume those verified prebuilts.

Rationale: it is the only option that satisfies the headless/no-X11 requirement and the "no undefined behavior" bar with configuration we control, gives SwiftShader + the right GPU backend on all three platforms, lets us respond to ANGLE security fixes on our schedule, and leaves room for sanitizer-instrumented builds. Its main cost, build time, is paid ~once a month rather than per PR. Option B would be acceptable only as a short-lived stopgap and is not recommended.

## Decisions

### Recipe pin (`angle/pin.toml`) and bundle manifest (`angle/bundles.toml`)

The build's inputs and its outputs live in separate files, so recording a
build's outputs does not trigger another build.

```toml
# angle/pin.toml: inputs; changing it (or anything else in the recipe) rebuilds ANGLE
angle_commit       = "<40-hex>"
chromium_branch    = "chromium/NNNN"   # informational: which stable branch the commit came from
bundle_version     = "angle-NNNN.<n>"  # release tag; <n> increments for rebuilds of the same branch
depot_tools_commit = "<40-hex>"
```

```toml
# angle/bundles.toml: outputs; what oxgl-sys downloads
bundle_version = "angle-NNNN.<n>"      # the recipe version these bundles were built from

[platform.linux-x64]
url    = "https://github.com/<org>/oxgl/releases/download/angle-NNNN.n/angle-linux-x64.tar.xz"
sha256 = "<64-hex>"
# ... macos-arm64, windows-x64
```

The recipe is every file that builds or tests a bundle (`pin.toml`, `args/`, `build.sh`, `build.ps1`, `scripts/bundle.py`, `scripts/pin.sh`, `smoke/`, `licenses.toml`, `license-texts/` under `angle/`),
plus the workflow file; `angle-build` runs on pull requests that touch it.
While `pin.toml` names a newer `bundle_version` than `bundles.toml` (between
a recipe change merging and its bundles being pinned), `oxgl-sys/build.rs`
builds against the older bundles and prints a warning.

### Published bundles are immutable

A published `bundle_version` is never rebuilt or replaced: ANGLE builds are
not bit-identical, so a rebuild would change every digest and break
verification for every commit pinned to the old ones. `angle-build` fails in
its first step when a release with the pin's `bundle_version` already exists,
so a recipe change without a version bump fails in seconds rather than after
the compile. The release job creates a release only, never uploads into an
existing one, and marks it `--latest=false` so ANGLE releases never become
the repository's "Latest" release (oxgl's own `v*` releases share the release
list).

### Build configuration (`angle/args/<platform>.gn`)

Common: `is_debug=false`, `is_component_build=false`, `symbol_level=1` (symbols split into a separate archive), `angle_enable_vulkan=true`, `angle_enable_swiftshader=true`, `angle_enable_gl=false`, `angle_enable_null=false`, `angle_build_tests=false`, `angle_has_frame_capture=false`, `angle_enable_perfetto=false`, `angle_enable_wgpu=false` (ANGLE enables its WebGPU backend by default on macOS and Windows; it links Dawn and, on Windows, DXC, roughly 9 MB that oxgl never uses).
Linux: display integrations off (`angle_use_x11=false`, `angle_use_wayland=false`, and any Ozone/X11 arg the pinned revision requires — confirmed in task 1.1).
macOS: `angle_enable_metal=true`, `target_cpu="arm64"`. Windows: `angle_enable_d3d11=true`, `angle_enable_d3d9=false`.

Exact GN arg names are verified against the pinned revision's `gni` files; the spec is about the outcome (no X11 linkage, required backends present), not specific arg names.

### Bundle layout

```
lib/       libEGL + libGLESv2 (+ Vulkan loader if ANGLE needs one) + vk_swiftshader + vk_swiftshader_icd.json
include/   EGL/, GLES2/, GLES3/, KHR/, plus ANGLE extension headers
licenses/  ANGLE (BSD-3), SwiftShader (Apache-2.0), LLVM/Subzero, Vulkan loader, and every other third_party in the link
BUILD_INFO.json  commit, branch, gn args, clang revision, SDK versions, glibc max symbol version (Linux), file digests
```

Compressed with xz (Python's standard library writes it, and the pure-Rust `lzma-rs` reads it, so neither side needs a native zstd); debug symbols in a sibling `-symbols` asset.

### Consumption by `oxgl-sys`

`build.rs` resolves the bundle in this order: `OXGL_ANGLE_DIR` → cache (`$CARGO_HOME/oxgl-angle/<sha256>/`, or `OXGL_ANGLE_CACHE`) → download from the pinned URL with `curl` (no HTTP/TLS crates in the build script, so no TLS-roots license issue). It verifies SHA-256 before extracting, then exposes the include path for bindgen (in `headless-context`) and records the bundle path in `target/<profile>/oxgl-angle-dir`. `npm run build` (`scripts/stage-angle.mjs`) then copies `lib/` to `dist/angle/` next to the built `.node` file and writes `dist/THIRD_PARTY_NOTICES`: the committed Rust-crate notices plus the license texts of every bundle component. A build script can't know where napi-rs puts the addon, so staging happens in the npm build. `build.rs` also re-checks every bundle component's license (from `BUILD_INFO.json`, read with `serde_json`) against the current `deny.toml` allowlist, so narrowing the allowlist fails the native build instead of waiting for the next ANGLE rebuild; `deny.toml` therefore stays out of the `angle-build` trigger.

ANGLE is **loaded at runtime by absolute path** (via `libloading` inside `oxgl-sys`), not linked at build time. The loader takes the bundle directory explicitly: the Node addon passes the directory next to the `.node` file, and Rust tests in any workspace crate (including `cargo test` and the ASan job, where no addon exists) get the staged directory from `oxgl_sys::test_support::bundle_dir()`. That function exists only with oxgl-sys's `test-support` feature, enabled through dev-dependencies, and is the only code that reads the build-time path (`cargo:rustc-env` from `build.rs`), so release binaries never embed the build machine's path. The production loader has no fallback, and the system library search path is never used. Reasons: avoids picking up a system `libEGL` (glvnd on Linux) or a different ANGLE already loaded in the process; avoids rpath/install-name/DLL-search-path differences across platforms; lets a missing library surface as a coded JS error instead of a dlopen failure at `require` time. GLES entry points are resolved through `eglGetProcAddress`. This adds `unsafe` only in `oxgl-sys`, as the rules require.

SwiftShader's ICD is located by ANGLE relative to its own library in the bundle; we do not set process-global `VK_ICD_FILENAMES`, so we never alter Vulkan behavior for other code in the host process. Task 1.3 verifies this holds on all three platforms.

### Linux glibc baseline

Built against Chromium's Debian sysroot; the build fails if any referenced glibc symbol is newer than **2.31** (Debian 11 / Ubuntu 20.04 era). The value is recorded in BUILD_INFO and the check is a script step.

### Update procedure

1. Change the recipe (the ANGLE commit and `chromium_branch` in `pin.toml`, GN args, targets, scripts or license data) and bump `bundle_version`. 2. Open a PR: `angle-build` builds, checks and smoke-tests all three platforms (create a SwiftShader display, clear, read back). 3. After it merges, run `angle-build` by hand from `main`; it creates a draft release with the digests in its summary. 4. Copy the URLs and digests into `bundles.toml` and open a PR; this does not rebuild ANGLE, and regular CI validates against the new bundles. 5. Publish the release when that PR merges.

## Safety Rules

- *Unsafe confinement:* dynamic loading and every FFI call live in `oxgl-sys`; `build.rs` code needs no `unsafe`.
- *No panics:* `build.rs` reports failures via `cargo::error=` messages and a non-zero exit, never `unwrap`. (Lints apply to build scripts too.)
- *Handle model / ArrayBuffer lifetime:* not touched.

## Risks / Trade-offs

- [ANGLE build breaks on a GitHub runner image update] → Workflow pins runner image versions; failure only blocks pin bumps, never regular CI.
- [Release assets deleted or repo renamed] → Digests in-repo make substitution detectable; a deleted asset is rebuilt under a new `bundle_version`, and commits pinned to the deleted one cannot build from a fresh cache until they move to it.
- [Long time-to-patch for a critical ANGLE CVE] → Documented update procedure; the build can run on larger runners to cut wall time.
- [Upstream removes or renames a GN arg] → Spec states outcomes; build script checks outcomes (linkage, backends) rather than trusting args.
- [Runtime loading picks wrong ICD or system Vulkan loader] → Smoke test asserts the SwiftShader renderer string; task 1.3 verifies isolation per platform.

## Open Questions

- Whether to use GitHub larger runners for `angle-build` (cost vs. ~3× faster builds). Doesn't change the design.
