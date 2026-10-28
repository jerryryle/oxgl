# Tasks

## 1. Build spike and recipe

- [x] 1.1 Pick an ANGLE commit on the current Chromium stable branch and write `angle/args/{linux-x64,macos-arm64,windows-x64}.gn`; verify each with `gn gen` + `gn args --list` that every arg exists at that revision
- [x] 1.2 Write `angle/build.sh` (and `build.ps1` for Windows) that fetches with depot_tools at the pinned commit, builds only the needed targets, and assembles the bundle layout; run it on each platform (sizes and wall times are not recorded: they drift with every ANGLE update)
- [x] 1.3 Add `angle/smoke/` (a tiny C program built against the bundle headers) that loads the bundle by absolute path, initializes a SwiftShader EGL display with no window system, clears a pbuffer, reads back a pixel, and checks `GL_RENDERER` names SwiftShader; verify it passes on all three platforms without setting `VK_ICD_FILENAMES`; verified in angle-build runs on PR #1 and `main`, where `GL_RENDERER` named the SwiftShader Vulkan device on all three platforms
- [x] 1.4 Add the outcome checks to the recipe: every linked component has an allowlisted SPDX license recorded in build-info and its license text in `licenses/`; Linux has no X11/xcb/Wayland `NEEDED` entries and no glibc symbol newer than 2.31; build-info lists Vulkan+SwiftShader everywhere, Metal on macOS, D3D11 on Windows; licenses directory covers every linked third_party; verify each check fails on a deliberately bad input; verified by running `bundle.py`'s checks with canned `gn`/`readelf`/`objdump` output (disabled backends, a missing GN arg, X11 enabled, X11/xcb/Wayland linkage, glibc 2.34, a disallowed, missing or textless license, a narrowed allowlist, a missing library or ICD manifest), each failing with its message

## 2. Pin and publishing workflow

- [x] 2.1 Add `angle/pin.toml` per design; verify a schema check script parses it and rejects a missing platform or malformed digest
- [x] 2.2 Add `.github/workflows/angle-build.yml` (manual dispatch; three-platform matrix; actions pinned by SHA; runs recipe, checks, smoke test; uploads bundles and symbols to a draft `angle-*` release and prints digests); verify one end-to-end run produces three bundles
- [x] 2.3 Fill `bundles.toml` digests from that run and publish the release; verify downloading each URL reproduces its digest, and that the `bundles.toml` PR does not run `angle-build`; verified: each published URL's download matched its digest, a clean `npm run build` with a fresh cache and no `OXGL_ANGLE_DIR` downloaded and staged the macOS bundle and the smoke test passed against it, and PR #2 ran no checks
- [x] 2.4 Split the bundle URLs and digests out of `pin.toml` into `bundles.toml`; exclude it and `angle/README.md` from the `angle-build` trigger; fail `angle-build` first thing when the pinned `bundle_version` is already released; make the release job create-only with `--latest=false`; have `build.rs` warn when `pin.toml` is ahead of `bundles.toml`; verify `check_pin.py` accepts and rejects both files, the warning appears, and the guard fails a run whose version is released (checked by running the guard step's script locally against the published release, not by a PR, so no recipe change is pushed); verified: the guard step's script failed for the published `angle-8078.1` and passed for `angle-8078.2`

## 3. Consumption in oxgl-sys

- [x] 3.1 Implement `crates/oxgl-sys/build.rs` resolution order (override → cache → verified download), digest verification before extraction, and staging `lib/` next to the addon; verify match, mismatch (build fails, nothing extracted), and cache hit (no network); verified by manual checks against a `file://` bundle URL (accepted instead of unit tests, since Cargo does not run tests in build scripts)
- [x] 3.2 Implement `OXGL_ANGLE_DIR` override with required-file checks and a cargo warning when in use; verify offline build succeeds with override and fails listing missing files for an incomplete directory
- [x] 3.3 Verify `cargo clippy --workspace --all-targets -- -D warnings` passes with the build script
- [x] 3.4 Re-check the bundle's component licenses against the current `deny.toml` allowlist in `build.rs`; verify that removing an allowlisted license a component uses fails the native build naming those components, and that a `deny.toml` without `[licenses] allow` fails with that message

## 4. Documentation

- [x] 4.1 Document the update procedure, override, and cache in `angle/README.md`; verify the procedure by performing a dry-run pin bump on a local branch that is never pushed (so `angle-build` never runs; steps that need a PR or a release are exercised by the real `angle-8078.1` cycle); verified: `pin.sh` read `angle-8078.2`, `check_pin.py` accepted both files, and `cargo build` warned that `pin.toml` is ahead and built against the cached `angle-8078.1` bundle
