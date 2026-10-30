# Spec Delta

## MODIFIED Requirements

### Requirement: ANGLE revision is pinned in the repository
The ANGLE build recipe SHALL live in its own repository (the recipe repository, `jerryryle/oxgl-angle`), separate from oxgl's. The recipe repository SHALL record a single pinned ANGLE source revision (commit hash and the Chromium release branch it was taken from), the bundle version, and the build configuration for each supported platform. oxgl's repository SHALL record, in its bundle manifest, the bundle version it uses and the URL and SHA-256 digest of each platform's bundle, with every URL pointing at that version's release in the recipe repository. Changing either SHALL be a reviewable change to tracked files in its repository.

#### Scenario: Pin is inspectable
- **WHEN** a reviewer reads the recipe repository's pin and oxgl's bundle manifest
- **THEN** the pin names the ANGLE commit, the Chromium branch and the bundle version, and the manifest names that bundle version with one bundle URL and SHA-256 digest for each of Linux x64, Linux arm64, macOS arm64, Windows x64, and Windows arm64

#### Scenario: Manifest URL outside the named release
- **WHEN** a bundle URL in oxgl's bundle manifest does not point at the recipe repository's release for the manifest's bundle version
- **THEN** oxgl's repository checks fail and name the platform and URL

### Requirement: ANGLE is built only when its recipe changes
ANGLE SHALL be built from source only by the recipe repository's build workflow. No workflow in oxgl's repository SHALL build ANGLE. The build workflow SHALL run for every pull request to the recipe repository and report one aggregate check that branch protection can require. It SHALL build and smoke-test bundles only when the pull request changes the build recipe (the pinned revision, build configuration, build scripts, license data and the bundle smoke test) or the build workflow itself, and the aggregate check SHALL pass without building otherwise. A change to the build workflow alone SHALL NOT require a new bundle version. A job the aggregate check depends on SHALL count as passing when skipped only if the pull request did not need it (the version check when no recipe file changed, the build and smoke tests when neither the recipe nor the workflow changed). Any other skip SHALL fail the aggregate check.

#### Scenario: Recording digests does not rebuild
- **WHEN** an oxgl pull request changes only the bundle manifest
- **THEN** no ANGLE build runs, and oxgl's CI builds and tests against the newly pinned bundles

#### Scenario: oxgl change does not rebuild
- **WHEN** an oxgl pull request changes only oxgl's Rust or JavaScript code
- **THEN** no ANGLE build runs, and the native build uses the pinned prebuilt bundle

#### Scenario: Recipe change builds and blocks
- **WHEN** a pull request to the recipe repository changes the build recipe
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

### Requirement: Reproducible build recipe
The recipe repository SHALL contain a scripted recipe that, given the pin manifest, builds each platform bundle from source on that platform. Each bundle's build-info SHALL record the toolchain and configuration used, so a rebuild from the same pin yields functionally identical libraries.

#### Scenario: Rebuild from pin
- **WHEN** the recipe is run on a supported platform with the current pin
- **THEN** it produces a bundle with the same file list and build configuration as the published one

### Requirement: Bundle licenses are on the project allowlist
Every component in a platform bundle SHALL carry a license on the project's license allowlist (see the licensing capability), recorded per component in build-info. The recipe repository SHALL keep its own copy of that allowlist. The build recipe SHALL fail if any linked component's license is missing from the bundle's license directory or is not on that copy. oxgl's allowlist is authoritative: oxgl's native build SHALL re-check the pinned bundle's recorded component licenses against it, so a bundle built under a wider or older copy cannot pass.

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
