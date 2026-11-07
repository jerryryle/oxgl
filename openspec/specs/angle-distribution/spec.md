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
ANGLE SHALL be built from source only by the recipe repository's build workflow, never in oxgl's repository. It SHALL run on every pull request and merge group and report one required aggregate check, which fails when a job the change needed was skipped. It SHALL build and smoke-test bundles only when the change touches the recipe or the workflow, and only in a merge group, a manual run or a `full-ci` pull request. A workflow-only change needs no new bundle version.

#### Scenario: Recording digests does not rebuild
- **WHEN** an oxgl pull request changes only the bundle manifest
- **THEN** no ANGLE build runs, and oxgl's CI builds and tests against the newly pinned bundles

#### Scenario: oxgl change does not rebuild
- **WHEN** an oxgl pull request changes only oxgl's Rust or JavaScript code
- **THEN** no ANGLE build runs, and the native build uses the pinned prebuilt bundle

#### Scenario: Recipe pull request
- **WHEN** a pull request to the recipe repository without the `full-ci` label changes the build recipe
- **THEN** workflow lint and the bundle-version guard run, no bundle is built, and the aggregate check passes if they pass

#### Scenario: Recipe change builds and blocks
- **WHEN** a merge group of the recipe repository changes the build recipe (the pinned revision, build configuration, build scripts, license data or the bundle smoke test)
- **THEN** every platform bundle is built and smoke-tested, oxgl's CI does not run, and the group lands only if every build and smoke test passed

#### Scenario: Workflow-only change
- **WHEN** a merge group of the recipe repository changes only the build workflow, such as an action version bump, and keeps a bundle version that is already released
- **THEN** every platform bundle is built and smoke-tested, nothing is released when it lands, and the aggregate check passes if every build and smoke test passed

#### Scenario: Unexpected skip
- **WHEN** a merge group of the recipe repository changes the build recipe or the build workflow, and a build or smoke job is skipped
- **THEN** the aggregate check fails

#### Scenario: Non-recipe change in the recipe repository
- **WHEN** a pull request or merge group of the recipe repository changes only documentation
- **THEN** no bundle is built and the aggregate check passes

### Requirement: Published bundles are immutable
A published bundle version SHALL never be rebuilt or replaced, and every recipe change SHALL produce a new bundle version (a change to the build workflow alone is not a recipe change). The build workflow SHALL fail before compiling when the pinned bundle version is already released, or when the change's own diff from the commit it is built on (a pull request's base; in a merge group, the parent of the group's head commit) touches the recipe and the version is not greater than at that commit.

#### Scenario: Forgotten version bump
- **WHEN** a pull request to the recipe repository changes a build recipe file other than the build workflow but keeps a bundle version that is already released
- **THEN** the build workflow fails in its first step, naming the version to bump

#### Scenario: Two recipe changes queued apart
- **WHEN** two recipe pull requests both set `bundle_version` to `angle-8078.10`, and the second is queued behind the first
- **THEN** the second entry's guard fails, naming `angle-8078.10`, so the second pull request leaves the queue and lands only after it picks a later version

#### Scenario: Documentation change queued behind a recipe change
- **WHEN** a README-only pull request is queued behind a recipe change that sets `angle-8078.10`
- **THEN** its own change touches no recipe file, so the guard doesn't compare versions for it

#### Scenario: Existing release is not overwritten
- **WHEN** the release job runs for a bundle version that already has a release
- **THEN** it fails without uploading anything

### Requirement: Released bundles are the tested bundles
The bundles a release publishes SHALL be the files that the merge group run that tested the released commit built and smoke-tested; the release SHALL NOT build anything. Copying a published bundle's files unchanged to another release, with the same digests, is not a rebuild.

#### Scenario: Released bundles are the smoke-tested ones
- **WHEN** a recipe change lands on the recipe repository's `main` and its bundle version is released
- **THEN** each released bundle's SHA-256 matches the bundle that the commit's merge group run built and smoke-tested, and no bundle is compiled after the change lands

#### Scenario: Recipe change merged past the queue
- **WHEN** a recipe change lands on the recipe repository's `main` without a merge group run
- **THEN** nothing is released, and the run's log says to start the build workflow manually on `main`, which builds, smoke-tests and releases that commit

### Requirement: Bundle contents
Each platform bundle SHALL contain the ANGLE EGL and GLES shared libraries, the SwiftShader Vulkan ICD and its manifest, any Vulkan loader ANGLE requires at runtime, the EGL/GLES/KHR headers including ANGLE extension headers, a build-info file recording the source revision and build configuration, and the license notices of every included component.

#### Scenario: Bundle is complete
- **WHEN** a platform bundle is extracted
- **THEN** the EGL library, GLES library, SwiftShader ICD, headers, build-info file, and license notices are all present, and build-info names the pinned commit

### Requirement: Backends enabled per platform
Every bundle SHALL include SwiftShader (via ANGLE's Vulkan backend). The Linux bundles (x64 and arm64) SHALL also enable ANGLE's Vulkan backend for hardware devices and ANGLE's OpenGL ES backend (`angle_enable_gl = true`) on the system's EGL driver. The macOS bundle SHALL enable its Metal backend, and the Windows bundles (x64 and arm64) their D3D11 backend. The macOS and Windows bundles SHALL NOT enable ANGLE's GL backend.

#### Scenario: Software backend available everywhere
- **WHEN** an EGL display is requested with the Vulkan platform type and SwiftShader device type from any platform bundle
- **THEN** display initialization succeeds on a machine with no GPU

#### Scenario: Platform GPU backend compiled in
- **WHEN** the build-info of each bundle is read
- **THEN** it shows Vulkan and GL enabled on both Linux bundles, Metal enabled and GL disabled on macOS, and D3D11 enabled and GL disabled on both Windows bundles

#### Scenario: OpenGL ES display on Mesa's surfaceless platform
- **WHEN** an EGL display is requested from a Linux bundle with the OpenGL ES platform type and native platform type `EGL_PLATFORM_SURFACELESS_MESA`, on a machine with Mesa's EGL installed
- **THEN** display initialization succeeds and an OpenGL ES 3.0 context can be created and made current without a surface

### Requirement: No window-system dependency
Bundled libraries SHALL load and create contexts without a window system. The Linux libraries SHALL NOT have link-time dependencies on X11, Wayland, GBM, libdrm, or any system EGL or GL library, and no platform SHALL require a display or session to be present. The system EGL library (`libEGL.so.1`) SHALL be opened only at run time, when an OpenGL ES display is initialized, so loading a bundle and using its Vulkan or SwiftShader displays SHALL work on a machine with no system EGL or GL libraries.

#### Scenario: Linux libraries have no X11 linkage
- **WHEN** the dynamic dependencies of the Linux bundle's libraries are listed
- **THEN** none of `libX11`, `libxcb`, or `libwayland-client` appear

#### Scenario: Linux libraries link no system graphics library
- **WHEN** the dynamic dependencies of the Linux bundle's libraries are listed
- **THEN** none of `libEGL.so.1`, `libGL`, `libGLESv2.so.2`, `libgbm` or `libdrm` appear, and only glibc's libraries, `libgcc_s` and `libm` remain

#### Scenario: Headless host
- **WHEN** a SwiftShader display is initialized on a Linux host with no `DISPLAY` or `WAYLAND_DISPLAY` set
- **THEN** initialization succeeds

#### Scenario: No Mesa installed
- **WHEN** oxgl is imported on a Linux machine with no system EGL or GL libraries, and Vulkan and SwiftShader contexts are created
- **THEN** both are created and render, and no attempt is made to open `libEGL.so.1`

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

### Requirement: Only releases from the recipe repository's own workflows are pinned
The bump SHALL pin a recipe-repository release only when GitHub Actions created it and uploaded every one of its assets, and its tag points at a commit on the recipe repository's `main`. Otherwise it SHALL refuse it and name the reason, and nothing SHALL be opened for it.

#### Scenario: Release created with a personal token
- **WHEN** the latest oxgl-angle release was created by a user account rather than `github-actions[bot]`
- **THEN** the bump opens no pull request and its log names the release and its author

#### Scenario: Asset replaced after release
- **WHEN** a release created by `github-actions[bot]` has an asset, such as `SHA256SUMS` or a bundle, uploaded by a user account
- **THEN** the bump opens no pull request and its log names the asset and its uploader

#### Scenario: Tag off main
- **WHEN** the latest release's tag points at a commit that isn't on oxgl-angle's `main`
- **THEN** the bump opens no pull request and its log names the tag and the commit

### Requirement: A bump that needs a person waits
A bump whose merge group run fails SHALL leave the queue and stay open. A later bump run SHALL NOT overwrite a bump branch that carries any commit other than the bot's. A commit a person pushes to the bump branch lands through the merge queue like any other change once the pull request's checks pass. A closed bump pull request labelled `skip-bump` SHALL stop the bump from proposing that bundle version again until the label is removed.

#### Scenario: Conformance changes with the new ANGLE
- **WHEN** a bump's merge group run fails because a conformance page's outcome changed
- **THEN** the pull request leaves the queue and stays open for a person to update the expectations, and no version is published

#### Scenario: Fix pushed to the bump
- **WHEN** a person pushes a commit that updates the expectations to the `angle-bump` branch
- **THEN** the pull request's checks run again, the pull request lands through the merge queue when they and its merge group run pass, and later bump runs leave the branch unchanged until then

#### Scenario: Skipped bundle version
- **WHEN** a bump pull request to `angle-8078.7` is labelled `skip-bump` and closed
- **THEN** later bump runs do not propose `angle-8078.7`, and they propose the next release after it once one exists

### Requirement: Recipe releases start oxgl's bump
When the recipe repository's release job publishes a bundle version, it SHALL then start oxgl's bump. oxgl's bump SHALL also run when started manually and on every push to `main`, and SHALL NOT run on a schedule.

#### Scenario: Release published
- **WHEN** the recipe repository releases `angle-8078.10`
- **THEN** oxgl's bump runs within minutes and proposes `angle-8078.10`

#### Scenario: Push to main
- **WHEN** a change lands on `main` while an unmodified bump pull request is open
- **THEN** oxgl's bump runs, and refreshes that pull request only as "A stale bump is rebuilt" requires

#### Scenario: Missed start
- **WHEN** a recipe release didn't start oxgl's bump
- **THEN** starting oxgl's bump manually proposes the latest release

### Requirement: New bundle releases are proposed when released
When oxgl's bump runs, once any version of `@oxgl-js/oxgl` is on npm, it SHALL compare the recipe repository's latest release with the bundle version oxgl pins. When they differ, it SHALL open or refresh a pull request from the `angle-bump` branch that pins the release's bundles and digests, taken from the release's `SHA256SUMS`, and bumps the patch version, and SHALL turn on the pull request's auto-merge so it lands through the merge queue once its checks pass.

#### Scenario: New release found
- **WHEN** the bump finds that oxgl-angle's latest release is `angle-8078.7`, `bundles.toml` pins `angle-8078.6`, and `version` is `0.1.3`
- **THEN** a pull request from `angle-bump` changes only `angle/bundles.toml` (every URL and digest from `angle-8078.7`'s release) and the version (`0.1.4` in `package.json` and `package-lock.json`), its quick checks run, and auto-merge is on

#### Scenario: Green bump lands and releases
- **WHEN** a bump's quick checks pass and its merge group run passes
- **THEN** it lands on `main` and `0.1.4` is published from that merge group run's packages (release, "A new version on main is released")

#### Scenario: Before the first release
- **WHEN** the bump finds a newer bundle release but npm has no published `@oxgl-js/oxgl`
- **THEN** it opens no pull request and changes nothing

#### Scenario: Nothing new
- **WHEN** the latest release is the pinned bundle version
- **THEN** no pull request is opened or changed, and an open bump pull request that main no longer needs is closed

### Requirement: A stale bump is rebuilt
When oxgl's bump runs, it SHALL rebuild an open bump that carries only the bot's commit from the current `main` when that bump's version is no longer greater than `main`'s or it no longer merges cleanly, and SHALL leave it unchanged otherwise, so a queued bump isn't pulled out of the queue.

#### Scenario: Main's version moved
- **WHEN** an unmodified bump to `0.2.3` is open and a developer's change that also bumps to `0.2.3` lands on `main`
- **THEN** the bump runs on that push and rebuilds the pull request from the current `main` at `0.2.4`, with auto-merge on

#### Scenario: Main moved without touching the bump
- **WHEN** an unmodified bump is in the merge queue and a documentation change lands on `main`
- **THEN** the bump leaves the pull request unchanged, and it stays in the queue

### Requirement: A stale recipe bump is rebuilt
The recipe repository's daily run SHALL rebuild an open bump that carries only the bot's commit only when Chrome stable moved again, its `bundle_version` is no longer greater than `main`'s, or it no longer merges cleanly, so a bump building in the queue isn't pulled out and restarted.

#### Scenario: Main moves while the bump is queued
- **WHEN** a recipe bump is building in the merge queue and a README change lands on the recipe repository's `main`
- **THEN** the next daily run leaves the bump unchanged, and its builds continue

### Requirement: The recipe repository follows Chrome stable
Once a day, when the ANGLE commit Chrome stable ships differs from the recipe repository's pinned commit, the recipe repository SHALL open a pull request from its `angle-bump` branch that pins that commit with a new bundle version, with auto-merge on, so the merge queue builds, smoke-tests and lands it. A bump that needs a person waits as oxgl's does.

#### Scenario: Chrome stable moves
- **WHEN** Chrome stable ships an ANGLE commit other than the pinned one
- **THEN** a pull request pins that commit with the next bundle version, and once its merge group run passes it lands, its bundles are released, and oxgl's bump starts

#### Scenario: A patch no longer applies
- **WHEN** the recipe bump's merge group run fails because a source patch doesn't apply to the new commit
- **THEN** the pull request leaves the queue and stays open for a person, and nothing is released
