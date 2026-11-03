# angle-distribution Specification

## Purpose

Defines how oxgl obtains, verifies, and ships the ANGLE and SwiftShader binaries it renders with, so that every build on every supported platform uses a known, reviewable, integrity-checked ANGLE revision.

## Requirements

### Requirement: ANGLE revision is pinned in the repository
The ANGLE build recipe SHALL live in its own repository, `oxgl-js/oxgl-angle` (the recipe repository), which SHALL record the pinned ANGLE revision (commit and Chromium branch), the bundle version and each platform's build configuration. oxgl's bundle manifest SHALL record the bundle version it uses and each platform's bundle URL and SHA-256 digest, every URL in that version's recipe-repository release. Changing either SHALL be a reviewable change to tracked files.

#### Scenario: Pin is inspectable
- **WHEN** a reviewer reads the recipe repository's pin and oxgl's bundle manifest
- **THEN** the pin names the ANGLE commit, the Chromium branch and the bundle version, and the manifest names that bundle version with one bundle URL and SHA-256 digest for each of Linux x64, Linux arm64, macOS arm64, Windows x64, and Windows arm64

#### Scenario: Manifest URL outside the named release
- **WHEN** a bundle URL in oxgl's bundle manifest does not point at the recipe repository's release for the manifest's bundle version
- **THEN** oxgl's repository checks fail and name the platform and URL

### Requirement: ANGLE is built only when its recipe changes
ANGLE SHALL be built from source only by the recipe repository's build workflow, never by a workflow in oxgl's repository. That workflow SHALL run for every pull request and report one aggregate check for branch protection. It SHALL build and smoke-test bundles only when the pull request changes the build recipe or the workflow itself, and a workflow-only change SHALL NOT require a new bundle version. The aggregate check SHALL fail when a job the change needed was skipped.

#### Scenario: Recording digests does not rebuild
- **WHEN** an oxgl pull request changes only the bundle manifest
- **THEN** no ANGLE build runs, and oxgl's CI builds and tests against the newly pinned bundles

#### Scenario: oxgl change does not rebuild
- **WHEN** an oxgl pull request changes only oxgl's Rust or JavaScript code
- **THEN** no ANGLE build runs, and the native build uses the pinned prebuilt bundle

#### Scenario: Recipe change builds and blocks
- **WHEN** a pull request to the recipe repository changes the build recipe (the pinned revision, build configuration, build scripts, license data or the bundle smoke test)
- **THEN** every platform bundle is built and smoke-tested, oxgl's CI does not run, and the aggregate check passes only if every build and smoke test passed

#### Scenario: Workflow-only change
- **WHEN** a pull request to the recipe repository changes only the build workflow, such as an action version bump, and keeps a bundle version that is already released
- **THEN** every platform bundle is built and smoke-tested, nothing is released, and the aggregate check passes if every build and smoke test passed

#### Scenario: Unexpected skip
- **WHEN** a pull request to the recipe repository changes the build recipe or the build workflow, and a build or smoke job is skipped
- **THEN** the aggregate check fails

#### Scenario: Non-recipe change in the recipe repository
- **WHEN** a pull request to the recipe repository changes only documentation
- **THEN** no bundle is built and the aggregate check passes

### Requirement: Published bundles are immutable
A published bundle version SHALL never be rebuilt or replaced. Every recipe change SHALL produce a new bundle version (a change to the build workflow alone is not a recipe change; see "ANGLE is built only when its recipe changes"), and the recipe repository's build workflow SHALL fail before compiling when the pinned bundle version is already released there. Copying a published bundle's files unchanged to another release, with the same digests, is not a rebuild.

#### Scenario: Forgotten version bump
- **WHEN** a pull request to the recipe repository changes a build recipe file other than the build workflow but keeps a bundle version that is already released
- **THEN** the build workflow fails in its first step, naming the version to bump

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
The recipe repository SHALL contain a scripted recipe that, given the pin manifest, builds each platform bundle from source on that platform. Each bundle's build-info SHALL record the toolchain and configuration used, so a rebuild from the same pin yields functionally identical libraries.

#### Scenario: Rebuild from pin
- **WHEN** the recipe is run on a supported platform with the current pin
- **THEN** it produces a bundle with the same file list and build configuration as the published one

### Requirement: Linux binary compatibility baseline
The Linux bundle SHALL declare the minimum glibc version it requires, and SHALL NOT require a glibc newer than the oldest glibc of the Linux distributions the project supports.

#### Scenario: glibc baseline recorded
- **WHEN** the Linux bundle's build-info is read
- **THEN** it states the maximum glibc symbol version referenced by the bundled libraries

### Requirement: Bundle licenses are on the project allowlist
Every component in a platform bundle SHALL carry a license on the project's allowlist (see the licensing capability), recorded per component in build-info. The build recipe SHALL fail if a linked component's license is missing from the bundle or not on the recipe repository's copy of the allowlist. oxgl's allowlist is authoritative: oxgl's native build SHALL re-check the pinned bundle's recorded licenses against it, so a bundle built under a wider or older copy cannot pass.

#### Scenario: Disallowed component license
- **WHEN** a pin bump pulls in a linked third-party component whose license is not on the recipe repository's allowlist
- **THEN** the bundle build fails and names the component and its license

#### Scenario: Allowlist narrowed after a bundle was built
- **WHEN** a license that a pinned bundle's component uses is removed from oxgl's allowlist
- **THEN** the native build fails and names that component and its license

#### Scenario: Recipe copy wider than oxgl's allowlist
- **WHEN** a bundle is built under a recipe allowlist that permits a license oxgl's allowlist does not
- **THEN** oxgl's native build against that bundle fails and names the component and its license

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

### Requirement: New bundle releases are proposed daily
Once a day, once any version of `@oxgl-js/oxgl` is on npm, a workflow SHALL compare the recipe repository's latest release with the bundle version oxgl pins. When they differ, it SHALL open or refresh a pull request from the `angle-bump` branch. That pull request SHALL pin the release's bundles and digests, taken from the release's `SHA256SUMS`, bump the patch version unless main's version is not yet on npm, and start CI on its head commit. It SHALL be based on the current `main`.

#### Scenario: New release found
- **WHEN** the daily run finds that oxgl-angle's latest release is `angle-8078.7`, `bundles.toml` pins `angle-8078.6`, and `version` is `0.1.3`
- **THEN** a pull request from `angle-bump` changes only `angle/bundles.toml` (every URL and digest from `angle-8078.7`'s release) and the version (`0.1.4` in `package.json` and `package-lock.json`), and CI runs on its head commit

#### Scenario: Unreleased version on main
- **WHEN** a new bundle release is found and `main` is at `0.2.0`, which npm does not have yet
- **THEN** the bump pull request leaves the version at `0.2.0`, so the release after it merges publishes `0.2.0` with the new bundles

#### Scenario: Before the first release
- **WHEN** the daily run finds a newer bundle release but npm has no published `@oxgl-js/oxgl`
- **THEN** it opens no pull request and changes nothing

#### Scenario: Nothing new
- **WHEN** the latest release is the pinned bundle version
- **THEN** no pull request is opened or changed, and an open bump pull request that main no longer needs is closed

#### Scenario: Main moved on
- **WHEN** an unmodified bump pull request is open and `main` has gained commits since it was made
- **THEN** the next daily run rebuilds the bump from the current `main` and starts CI on it again

### Requirement: Only releases from the recipe repository's own workflows are pinned
The daily bump and the merge SHALL pin a recipe-repository release only when GitHub Actions created it and uploaded every one of its assets, and its tag points at a commit on the recipe repository's `main`. Otherwise they SHALL refuse it and name the reason, and nothing SHALL be opened or merged for it.

#### Scenario: Release created with a personal token
- **WHEN** the latest oxgl-angle release was created by a user account rather than `github-actions[bot]`
- **THEN** the daily run opens no pull request and its log names the release and its author

#### Scenario: Asset replaced after release
- **WHEN** a release created by `github-actions[bot]` has an asset, such as `SHA256SUMS` or a bundle, uploaded by a user account
- **THEN** the daily run opens no pull request and its log names the asset and its uploader

#### Scenario: Tag off main
- **WHEN** the latest release's tag points at a commit that isn't on oxgl-angle's `main`
- **THEN** the daily run opens no pull request and its log names the tag and the commit

### Requirement: A passing bump merges and releases
When CI passes on the `angle-bump` head commit, and that commit is exactly the change the bump would make to the current `main` for the bundle version the commit names, CI SHALL merge the pull request at that commit and start CI on `main`. The new version is then released as any other new version is (release, "A new version on main is released").

#### Scenario: Green bump
- **WHEN** CI passes on an unmodified bump to `angle-8078.7` at version `0.1.4`
- **THEN** the pull request is squash-merged at the tested commit, CI runs on `main`, and `0.1.4` is published to npm once that run passes

#### Scenario: Newer bundle released during CI
- **WHEN** CI passes on a bump to `angle-8078.7`, and oxgl-angle released `angle-8078.8` while it ran
- **THEN** the bump to `angle-8078.7` is merged and released, and the next daily run proposes `angle-8078.8`

#### Scenario: Main moved during CI
- **WHEN** CI passes on a bump but `main` gained a commit while it ran
- **THEN** the pull request is not merged, and the next daily run refreshes it

### Requirement: A bump that needs a person waits
A bump whose CI fails, or whose branch carries any commit other than the bot's, SHALL stay open and SHALL NOT be merged automatically or overwritten by a later daily run. A closed bump pull request labelled `skip-bump` SHALL stop the daily run from proposing that bundle version again until the label is removed.

#### Scenario: Conformance changes with the new ANGLE
- **WHEN** a bump's CI fails because a conformance page's outcome changed
- **THEN** the pull request stays open for a person to update the expectations, and no version is published

#### Scenario: Fix pushed to the bump
- **WHEN** a person pushes a commit to `angle-bump` and CI passes
- **THEN** the pull request is not merged automatically, and the next daily run leaves the branch unchanged

#### Scenario: Skipped bundle version
- **WHEN** a bump pull request to `angle-8078.7` is labelled `skip-bump` and closed
- **THEN** later daily runs do not propose `angle-8078.7`, and they propose the next release after it once one exists
