# Proposal

## Why

oxgl's first application runs on Linux arm64, which oxgl does not support today. Until the WebGL API is complete, testing three platforms triples CI time and cost for platforms no one uses yet. Building ANGLE for every target now keeps the recipe working everywhere, so the porting work expected when the other platforms return is limited to oxgl itself.

## What Changes

- **ANGLE for every eventual target.** The ANGLE recipe and build workflow produce bundles for five targets: `linux-x64`, `linux-arm64`, `macos-arm64`, `windows-x64` and `windows-arm64`. The two new arm64 bundles are cross-compiled on x64 hosts, which is Chromium's supported path, and smoke-tested on GitHub's arm64 runners (`ubuntu-24.04-arm`, `windows-11-arm`). Both are free for public repositories. A new bundle version is released and pinned with five digests.
- **Linux arm64 bundles run on any arm64 page size.** Linux arm64 kernels use 4, 16 or 64 KiB pages depending on the distribution, and a library linked for smaller pages fails to load on a kernel with larger ones. The bundle checks enforce 64 KiB load-segment alignment.
- **oxgl builds for every target, supports only Linux arm64.** `oxgl-sys` and the build scripts recognise all five targets, so a developer can still build and try oxgl locally on macOS or elsewhere. The declared supported platform and the npm `napi.targets` list are Linux arm64 only. **BREAKING** (pre-release): Linux x64, macOS arm64 and Windows x64 are no longer supported or tested.
- **CI focuses on Linux arm64.** The `check`, `node-range` and `asan` jobs run on `ubuntu-24.04-arm`. Every other platform's matrix entry stays in `ci.yml`, commented out behind a searchable `PLATFORM-FOCUS` marker. The ANGLE build workflow keeps all five targets.
- **The conformance-harness proposal moves to Linux arm64.** Its CI job runs on `ubuntu-24.04-arm` instead of `ubuntu-24.04`.
- **A final task group restores the other platforms.** When oxgl is fully standards-compliant, it surveys every platform, including Windows arm64 as a new fifth supported target, with CI re-enabled outside the required check. It spawns one reviewed OpenSpec port change per platform that needs work, and makes each platform required again as its port change lands. This change stays open until then.

## Capabilities

### New Capabilities

None.

### Modified Capabilities
- `angle-distribution`: Five platform bundles instead of three. Linux arm64 and Windows arm64 backends, a page-size compatibility check (64 KiB load-segment alignment), and smoke tests on the target architecture.
- `continuous-integration`: The platform matrix and ASan job run on Linux arm64 only while the focus lasts.
- `node-api`: The supported host platform is Linux arm64 only while the focus lasts.

## Impact

- Recipe: `angle/args/linux-arm64.gn`, `angle/args/windows-arm64.gn`, `angle/build.sh` (arm64 sysroot and cross-compile), `angle/build.ps1` (platform parameter), `angle/scripts/bundle.py`, `angle/scripts/check_pin.py`, `angle/pin.toml` (bundle version bump), `.github/workflows/angle-build.yml` (five builds, arm64 smoke jobs), then `angle/bundles.toml` with five digests.
- oxgl: `crates/oxgl-sys/build.rs` (platform table), `scripts/stage-angle.mjs` (triples), `package.json` `napi.targets`, `deny.toml` and `about.toml` target lists (all five, so license data covers every target ANGLE is built for), `.github/workflows/ci.yml`, `CONTRIBUTING.md`, `README.md`, `angle/README.md`, and `openspec/config.yaml`'s target-platform line.
- `openspec/changes/conformance-harness`: Linux x64 becomes Linux arm64 in its CI requirement, design and tasks.
- Runtime: on Linux arm64, the GPU backend is ANGLE's Vulkan backend on whatever hardware Vulkan driver the host has. SwiftShader stays the software fallback.

## Out of Scope and Extension Points

- **GPU and larger-page testing in CI.** GitHub's arm64 runners have 4 KiB pages and no GPU. The existing `gpu` job slot (`runs-on: [self-hosted, oxgl-gpu]`) can take a self-hosted Linux arm64 machine later. Until then, page-size compatibility is enforced by the bundle check.
- **32-bit Arm Linux (armhf).**
- **Linux arm64 musl** (Alpine) and other libc variants.
- **Prebuilt npm packages.** Publishing is not set up yet, and this change does not add it.
- **GPU-backend conformance on arm64 hardware.** This change makes contexts work on Linux arm64. WebGL correctness on particular arm64 GPU drivers is measured once the conformance harness and a GPU runner exist.
