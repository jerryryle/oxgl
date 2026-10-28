# Spec Delta

## MODIFIED Requirements

### Requirement: ANGLE revision is pinned in the repository
The repository SHALL record a single pinned ANGLE source revision (commit hash and the Chromium release branch it was taken from), the build configuration for each supported platform, and the SHA-256 digest of each platform's ANGLE bundle. Changing any of these SHALL be a reviewable change to tracked files.

#### Scenario: Pin is inspectable
- **WHEN** a reviewer reads the recipe pin and the bundle manifest
- **THEN** the pin names the ANGLE commit and the Chromium branch, and the manifest names one bundle URL and SHA-256 digest for each of Linux x64, Linux arm64, macOS arm64, Windows x64, and Windows arm64

### Requirement: Backends enabled per platform
Every bundle SHALL include SwiftShader (via ANGLE's Vulkan backend). The Linux bundles (x64 and arm64) SHALL also enable ANGLE's Vulkan backend for hardware devices, the macOS bundle its Metal backend, and the Windows bundles (x64 and arm64) their D3D11 backend.

#### Scenario: Software backend available everywhere
- **WHEN** an EGL display is requested with the Vulkan platform type and SwiftShader device type from any platform bundle
- **THEN** display initialization succeeds on a machine with no GPU

#### Scenario: Platform GPU backend compiled in
- **WHEN** the build-info of each bundle is read
- **THEN** it shows Vulkan enabled on both Linux bundles, Metal enabled on macOS, and D3D11 enabled on both Windows bundles

## ADDED Requirements

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
