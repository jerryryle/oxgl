# angle-distribution Specification

## Purpose

Defines how oxgl obtains, verifies, and ships the ANGLE and SwiftShader binaries it renders with, so that every build on every supported platform uses a known, reviewable, integrity-checked ANGLE revision.

## Requirements

### Requirement: ANGLE revision is pinned in the repository
The repository SHALL record a single pinned ANGLE source revision (commit hash and the Chromium release branch it was taken from), the build configuration for each supported platform, and the SHA-256 digest of each platform's ANGLE bundle. Changing any of these SHALL be a reviewable change to tracked files.

#### Scenario: Pin is inspectable
- **WHEN** a reviewer reads the recipe pin and the bundle manifest
- **THEN** the pin names the ANGLE commit and the Chromium branch, and the manifest names one bundle URL and SHA-256 digest for each of Linux x64, Linux arm64, macOS arm64, Windows x64, and Windows arm64

### Requirement: ANGLE is built only when its recipe changes
ANGLE SHALL be built from source only by the ANGLE build workflow, which SHALL run only for changes to the build recipe (the pinned revision, build configuration, build scripts, license data and the bundle smoke test). Recording the digests of published bundles and changes to oxgl's own code SHALL NOT build ANGLE.

#### Scenario: Recording digests does not rebuild
- **WHEN** a pull request changes only the bundle manifest
- **THEN** the ANGLE build workflow does not run

#### Scenario: oxgl change does not rebuild
- **WHEN** a pull request changes only oxgl's Rust or JavaScript code
- **THEN** the ANGLE build workflow does not run, and the native build uses the pinned prebuilt bundle

### Requirement: Published bundles are immutable
A published bundle version SHALL never be rebuilt or replaced. Every recipe change SHALL produce a new bundle version, and the build workflow SHALL fail before compiling when the pinned bundle version is already released. ANGLE bundle releases SHALL NOT be marked as the repository's latest release.

#### Scenario: Forgotten version bump
- **WHEN** a pull request changes the build recipe but keeps a bundle version that is already released
- **THEN** the ANGLE build workflow fails in its first step, naming the version to bump

#### Scenario: Existing release is not overwritten
- **WHEN** the release job runs for a bundle version that already has a release
- **THEN** it fails without uploading anything

### Requirement: Bundle contents
Each platform bundle SHALL contain the ANGLE EGL and GLES shared libraries, the SwiftShader Vulkan ICD and its manifest, any Vulkan loader ANGLE requires at runtime, the EGL/GLES/KHR headers including ANGLE extension headers, a build-info file recording the source revision and build configuration, and the license notices of every included component.

#### Scenario: Bundle is complete
- **WHEN** a platform bundle is extracted
- **THEN** the EGL library, GLES library, SwiftShader ICD, headers, build-info file, and license notices are all present, and build-info names the pinned commit

### Requirement: Backends enabled per platform
Every bundle SHALL include SwiftShader (via ANGLE's Vulkan backend). The Linux bundles (x64 and arm64) SHALL also enable ANGLE's Vulkan backend for hardware devices, the macOS bundle its Metal backend, and the Windows bundles (x64 and arm64) their D3D11 backend.

#### Scenario: Software backend available everywhere
- **WHEN** an EGL display is requested with the Vulkan platform type and SwiftShader device type from any platform bundle
- **THEN** display initialization succeeds on a machine with no GPU

#### Scenario: Platform GPU backend compiled in
- **WHEN** the build-info of each bundle is read
- **THEN** it shows Vulkan enabled on both Linux bundles, Metal enabled on macOS, and D3D11 enabled on both Windows bundles

### Requirement: No window-system dependency
Bundled libraries SHALL load and create contexts without a window system: the Linux libraries SHALL NOT have link-time dependencies on X11, Wayland, or any display server library, and no platform SHALL require a display or session to be present.

#### Scenario: Linux libraries have no X11 linkage
- **WHEN** the dynamic dependencies of the Linux bundle's libraries are listed
- **THEN** none of `libX11`, `libxcb`, or `libwayland-client` appear

#### Scenario: Headless host
- **WHEN** a SwiftShader display is initialized on a Linux host with no `DISPLAY` or `WAYLAND_DISPLAY` set
- **THEN** initialization succeeds

### Requirement: Integrity verification
The native build SHALL verify each downloaded bundle against the pinned SHA-256 digest before extracting it, and SHALL fail the build with an error naming the expected and actual digests on mismatch. It SHALL NOT fall back to an unverified download.

#### Scenario: Tampered bundle is rejected
- **WHEN** the downloaded bundle's digest differs from the pin
- **THEN** the build fails, nothing is extracted, and the error shows both digests

#### Scenario: Cached bundle is reused
- **WHEN** a bundle matching the pinned digest is already present in the local cache
- **THEN** the build uses it without a network request

### Requirement: Local override
Setting `OXGL_ANGLE_DIR` to a directory with the bundle layout SHALL make the native build use that directory instead of downloading, so developers can build offline or test a locally built ANGLE. The build SHALL report that an override is in use.

#### Scenario: Offline build with override
- **WHEN** `OXGL_ANGLE_DIR` points at an extracted bundle and the network is unavailable
- **THEN** the native build succeeds and prints a notice that the override was used

#### Scenario: Invalid override directory
- **WHEN** `OXGL_ANGLE_DIR` points at a directory missing required files
- **THEN** the build fails with an error listing the missing files

### Requirement: Reproducible build recipe
The repository SHALL contain a scripted recipe that, given the pin manifest, builds each platform bundle from source on that platform. Each bundle's build-info SHALL record the toolchain and configuration used, so a rebuild from the same pin yields functionally identical libraries.

#### Scenario: Rebuild from pin
- **WHEN** the recipe is run on a supported platform with the current pin
- **THEN** it produces a bundle with the same file list and build configuration as the published one

### Requirement: Linux binary compatibility baseline
The Linux bundle SHALL declare the minimum glibc version it requires, and SHALL NOT require a glibc newer than the oldest glibc of the Linux distributions the project supports.

#### Scenario: glibc baseline recorded
- **WHEN** the Linux bundle's build-info is read
- **THEN** it states the maximum glibc symbol version referenced by the bundled libraries

### Requirement: Bundle licenses are on the project allowlist
Every component in a platform bundle SHALL carry a license on the project's license allowlist (see the licensing capability), recorded per component in build-info. The build recipe SHALL fail if any linked component's license is missing from the bundle's license directory or is not on the allowlist. The native build SHALL re-check the pinned bundle's recorded component licenses against the current allowlist, so a narrowed allowlist cannot pass with a bundle built under an older one.

#### Scenario: Disallowed component license
- **WHEN** a pin bump pulls in a linked third-party component whose license is not on the allowlist
- **THEN** the bundle build fails and names the component and its license

#### Scenario: Allowlist narrowed after a bundle was built
- **WHEN** a license that a pinned bundle's component uses is removed from the allowlist
- **THEN** the native build fails and names that component and its license

#### Scenario: Per-component license recorded
- **WHEN** a bundle's build-info is read
- **THEN** it lists every linked component with its SPDX license identifier

### Requirement: Linux arm64 bundle loads with any arm64 page size
Every shared library in the Linux arm64 bundle SHALL have loadable segments aligned to at least 64 KiB, the largest arm64 page size, so it loads on kernels using 4, 16 or 64 KiB pages. The bundle build SHALL fail if any library's alignment is smaller.

#### Scenario: Under-aligned library rejected
- **WHEN** a Linux arm64 bundle library has a `LOAD` segment aligned to 4 KiB or 16 KiB
- **THEN** the bundle build fails and names the library and its alignment

#### Scenario: Alignment recorded
- **WHEN** the Linux arm64 bundle's build-info is read
- **THEN** it states the smallest `LOAD` segment alignment across the bundled libraries

### Requirement: Bundles are smoke-tested on their target architecture
The ANGLE build workflow SHALL run each bundle's smoke test on a host of the bundle's own operating system and architecture, including bundles cross-compiled on a host of another architecture. A smoke-test failure SHALL fail the workflow and prevent a release.

#### Scenario: Cross-compiled arm64 bundle
- **WHEN** the Linux arm64 bundle is built on an x64 host
- **THEN** its smoke test runs on a Linux arm64 runner, and the release job runs only if that smoke test passed
