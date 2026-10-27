# Proposal

## Why

oxgl renders through ANGLE (EGL + GLES) with SwiftShader as the software fallback, but Google publishes no ANGLE release binaries. Before any context can be created we need a defined, reproducible, verifiable way to obtain ANGLE + SwiftShader for Linux x64, macOS arm64, and Windows x64, both for developers and for CI, without making every build compile ANGLE.

## What Changes

- Choose how ANGLE is obtained (design.md compares building from source with depot_tools against vendoring third-party prebuilt binaries; recommendation: **build from source ourselves, in a dedicated pinned workflow, and consume the results as verified prebuilt artifacts**).
- Add an ANGLE pin to the repo: ANGLE commit, the Chromium release branch it tracks, GN args per platform, and the SHA-256 of each platform artifact.
- Add a build recipe (script + GitHub Actions workflow, manually or tag-triggered) that produces per-platform ANGLE bundles: `libEGL`, `libGLESv2`, the SwiftShader Vulkan ICD and its manifest, headers, license notices, and a build-info record.
- Teach `oxgl-sys`'s build script to fetch the pinned bundle, verify its checksum, and stage it next to the native addon, with an environment override for local or offline builds.

## Capabilities

### New Capabilities
- `angle-distribution`: How oxgl obtains, verifies, and ships ANGLE and SwiftShader binaries: pinning, artifact contents per platform, integrity checking, licensing, local overrides, and the update procedure.

### Modified Capabilities

None.

## Impact

- New: `angle/` (pin manifest, GN args files, build script, patches directory, README), `.github/workflows/angle-build.yml`.
- `crates/oxgl-sys/build.rs` gains download + verification + staging; new build-dependencies for HTTP and SHA-256.
- GitHub Releases on the oxgl repo host the ANGLE bundles (tag prefix `angle-`), roughly 15-40 MB compressed per platform.
- Depends on `bootstrap-workspace` (the `oxgl-sys` crate must exist). The CI workflow that runs the ANGLE build is defined here; the regular CI that consumes it is `ci-pipeline`.

## Out of Scope and Extension Points

- No EGL/GLES bindings or context code (`headless-context`). This change only guarantees the libraries and headers are present and verified.
- No npm packaging of the bundle; the release change that defines per-platform npm packages will copy the staged files into them.
- Additional platforms (Linux arm64, macOS x64, Windows arm64) are additional rows in the pin manifest and matrix; the format is designed for that.
- Building ANGLE with sanitizers (for a fully instrumented ASan run) is a later option of the same recipe via an extra GN args file.
