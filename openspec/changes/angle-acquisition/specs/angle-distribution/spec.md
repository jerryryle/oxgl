# Spec Delta

## Purpose

Defines how oxgl obtains, verifies, and ships the ANGLE and SwiftShader binaries it renders with, so that every build on every supported platform uses a known, reviewable, integrity-checked ANGLE revision.

## ADDED Requirements

### Requirement: ANGLE revision is pinned in the repository
The repository SHALL record a single pinned ANGLE source revision (commit hash and the Chromium release branch it was taken from), the build configuration for each supported platform, and the SHA-256 digest of each platform's ANGLE bundle. Changing any of these SHALL be a reviewable change to tracked files.

#### Scenario: Pin is inspectable
- **WHEN** a reviewer reads the pin manifest
- **THEN** it names the ANGLE commit, the Chromium branch, and one bundle URL and SHA-256 digest for each of Linux x64, macOS arm64, and Windows x64

### Requirement: Bundle contents
Each platform bundle SHALL contain the ANGLE EGL and GLES shared libraries, the SwiftShader Vulkan ICD and its manifest, any Vulkan loader ANGLE requires at runtime, the EGL/GLES/KHR headers including ANGLE extension headers, a build-info file recording the source revision and build configuration, and the license notices of every included component.

#### Scenario: Bundle is complete
- **WHEN** a platform bundle is extracted
- **THEN** the EGL library, GLES library, SwiftShader ICD, headers, build-info file, and license notices are all present, and build-info names the pinned commit

### Requirement: Backends enabled per platform
Every bundle SHALL include SwiftShader (via ANGLE's Vulkan backend). The Linux bundle SHALL also enable ANGLE's Vulkan backend for hardware devices, the macOS bundle its Metal backend, and the Windows bundle its D3D11 backend.

#### Scenario: Software backend available everywhere
- **WHEN** an EGL display is requested with the Vulkan platform type and SwiftShader device type from any platform bundle
- **THEN** display initialization succeeds on a machine with no GPU

#### Scenario: Platform GPU backend compiled in
- **WHEN** the build-info of each bundle is read
- **THEN** it shows Vulkan enabled on Linux, Metal enabled on macOS, and D3D11 enabled on Windows

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
Every component in a platform bundle SHALL carry a license on the project's license allowlist (see the licensing capability), recorded per component in build-info. The build recipe SHALL fail if any linked component's license is missing from the bundle's license directory or is not on the allowlist.

#### Scenario: Disallowed component license
- **WHEN** a pin bump pulls in a linked third-party component whose license is not on the allowlist
- **THEN** the bundle build fails and names the component and its license

#### Scenario: Per-component license recorded
- **WHEN** a bundle's build-info is read
- **THEN** it lists every linked component with its SPDX license identifier
