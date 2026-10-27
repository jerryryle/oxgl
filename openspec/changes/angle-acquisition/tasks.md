# Tasks

## 1. Build spike and recipe

- [x] 1.1 Pick an ANGLE commit on the current Chromium stable branch and write `angle/args/{linux-x64,macos-arm64,windows-x64}.gn`; verify each with `gn gen` + `gn args --list` that every arg exists at that revision
- [ ] 1.2 Write `angle/build.sh` (and `build.ps1` for Windows) that fetches with depot_tools at the pinned commit, builds only the needed targets, and assembles the bundle layout; run it on each platform and record wall time, checkout size, and bundle size in `angle/README.md`
- [ ] 1.3 Add `angle/smoke/` (a tiny C program built against the bundle headers) that loads the bundle by absolute path, initializes a SwiftShader EGL display with no window system, clears a pbuffer, reads back a pixel, and checks `GL_RENDERER` names SwiftShader; verify it passes on all three platforms without setting `VK_ICD_FILENAMES`
- [ ] 1.4 Add the outcome checks to the recipe: every linked component has an allowlisted SPDX license recorded in build-info and its license text in `licenses/`; Linux has no X11/xcb/Wayland `NEEDED` entries and no glibc symbol newer than 2.31; build-info lists Vulkan+SwiftShader everywhere, Metal on macOS, D3D11 on Windows; licenses directory covers every linked third_party; verify each check fails on a deliberately bad input

## 2. Pin and publishing workflow

- [x] 2.1 Add `angle/pin.toml` per design; verify a schema check script parses it and rejects a missing platform or malformed digest
- [ ] 2.2 Add `.github/workflows/angle-build.yml` (manual dispatch; three-platform matrix; actions pinned by SHA; runs recipe, checks, smoke test; uploads bundles and symbols to a draft `angle-*` release and prints digests); verify one end-to-end run produces three bundles
- [ ] 2.3 Fill `pin.toml` digests from that run and publish the release; verify downloading each URL reproduces its digest

## 3. Consumption in oxgl-sys

- [ ] 3.1 Implement `crates/oxgl-sys/build.rs` resolution order (override → cache → verified download), digest verification before extraction, and staging `lib/` next to the addon; verify with unit tests for match, mismatch (build fails, nothing extracted), and cache hit (no network)
- [x] 3.2 Implement `OXGL_ANGLE_DIR` override with required-file checks and a cargo warning when in use; verify offline build succeeds with override and fails listing missing files for an incomplete directory
- [x] 3.3 Verify `cargo clippy --workspace --all-targets -- -D warnings` passes with the build script

## 4. Documentation

- [ ] 4.1 Document the update procedure, override, and cache in `angle/README.md`; verify the procedure by performing a dry-run pin bump on a branch
