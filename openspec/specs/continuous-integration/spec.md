# continuous-integration Specification

## Purpose
Defines the automated checks every oxgl change must pass before merge: the jobs, platforms, and triggers; what each job verifies; how CI obtains ANGLE; and the security posture of the workflows themselves.

## Requirements

### Requirement: Triggers
CI SHALL run on every pull request targeting `main` and on every push to `main`, and SHALL cancel superseded runs for the same pull request.

#### Scenario: Pull request opened
- **WHEN** a pull request targeting `main` is opened or updated
- **THEN** the CI workflow runs against its head commit and any earlier run for that pull request is cancelled

### Requirement: Platform matrix
The main CI job SHALL run on Linux arm64, the only supported platform during the Linux arm64 focus (see node-api), and a failure SHALL fail the overall check. The other platforms' job entries SHALL remain in the workflow, disabled and marked so they can be found and restored.

#### Scenario: Windows-only failure
- **WHEN** CI runs during the Linux arm64 focus
- **THEN** no job that builds or tests oxgl runs on Windows, macOS or Linux x64, a test failure on Linux arm64 fails the aggregate CI check, and the disabled platforms' entries are present behind the `PLATFORM-FOCUS` marker. Host-independent checks, such as workflow lint and license checks, and the ANGLE build workflow are unaffected.

#### Scenario: Disabled platforms are findable
- **WHEN** a maintainer searches the CI workflow for the `PLATFORM-FOCUS` marker
- **THEN** every disabled matrix entry and runner for Linux x64, macOS arm64 and Windows x64 is found next to it

### Requirement: Rust checks
On each platform, CI SHALL run `cargo fmt --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings` (with the workspace's pedantic configuration), and `cargo test --workspace --exclude oxgl-node --locked` (oxgl-node is a Node addon whose tests run under Node), using the pinned toolchain.

#### Scenario: Pedantic lint fails CI
- **WHEN** a change introduces code that triggers a clippy pedantic lint
- **THEN** the clippy step fails and the CI check fails

#### Scenario: Lockfile drift fails CI
- **WHEN** `Cargo.lock` is out of date with the manifests
- **THEN** CI fails rather than updating the lockfile

### Requirement: Node checks in software mode
On each platform, CI SHALL install dependencies with `npm ci`, run the JS lint and type check, build the native addon and package, and run the Node test suite (including the soak test) with `OXGL_BACKEND=software`.

#### Scenario: Software rendering on every platform
- **WHEN** the Node test step runs
- **THEN** `OXGL_BACKEND` is `software` and clear-then-readPixels and soak tests execute (not skip) on every platform in the matrix

### Requirement: AddressSanitizer job
CI SHALL include a Linux arm64 job that builds and runs the Rust test suites, including the SwiftShader integration and soak tests, with AddressSanitizer and LeakSanitizer enabled. Any sanitizer report SHALL fail the job.

#### Scenario: Use-after-free is caught
- **WHEN** a change introduces a use-after-free in oxgl code exercised by the tests
- **THEN** the ASan job fails with an AddressSanitizer report

#### Scenario: Leak in oxgl code is caught
- **WHEN** a change leaks memory allocated by oxgl code in a tested path
- **THEN** the job fails with a LeakSanitizer report not covered by any suppression

### Requirement: Leak suppressions are narrow
Leak suppressions SHALL name internal functions of a third-party component that make one-time allocations (process-lifetime caches, static initialization) or per-thread allocations the component never frees by design. They SHALL NOT name a library or an exported EGL/GL/Vulkan entry point, and SHALL be checked into the repository with a justification for each entry.

#### Scenario: Broad suppression is rejected in review
- **WHEN** a pull request adds a suppression naming `libGLESv2` or `eglInitialize`
- **THEN** it does not meet this requirement, because it would hide every unreachable allocation made under that library or entry point

#### Scenario: ANGLE per-thread state is suppressed by its internal function
- **WHEN** the ASan job's test threads exit after making EGL calls
- **THEN** ANGLE's per-thread state allocated under `egl::GetCurrentThread` is suppressed by name, and no other ANGLE allocation is

### Requirement: Suppressions match unstripped ANGLE libraries
The ASan job SHALL run the tests against the unstripped ANGLE libraries from the platform's pinned symbols archive, so suppressions can match ANGLE-internal functions. The archive SHALL be pinned by URL and SHA-256 next to the bundle and verified before extraction, like the bundle (angle-distribution, Integrity verification).

#### Scenario: Symbols archive with a wrong digest
- **WHEN** the pinned symbols archive's digest does not match the downloaded file
- **THEN** the build fails before anything is extracted, and the ASan job does not run against unverified libraries

### Requirement: ANGLE obtained from the pinned bundle
CI SHALL obtain ANGLE only through the pinned, checksum-verified bundle defined by angle-distribution, MAY cache it keyed by its digest, and SHALL NOT build ANGLE from source.

#### Scenario: Cache keyed by digest
- **WHEN** a bundle digest in the bundle manifest changes
- **THEN** the next CI run misses the cache, downloads and verifies the new bundle, and caches it under the new digest

### Requirement: Workflow security
Workflows SHALL reference third-party actions by full commit SHA, SHALL declare minimal `permissions` (read-only `contents` for CI), and SHALL NOT expose repository secrets to jobs triggered by pull requests from forks.

#### Scenario: Unpinned action rejected
- **WHEN** a workflow file references an action by tag instead of commit SHA
- **THEN** a workflow lint step in CI fails

### Requirement: Aggregate status check
CI SHALL expose a single aggregate check named `ci` that succeeds only when every required job succeeds, so branch protection can require one stable check name as jobs evolve.

#### Scenario: Skipped required job
- **WHEN** a required job is cancelled or skipped due to an upstream failure
- **THEN** the `ci` check reports failure

### Requirement: License check
CI SHALL run the project's license check on every pull request: dependency licenses against the allowlist, and `THIRD_PARTY_NOTICES` against the current dependency graph. A failure SHALL fail the aggregate `ci` check.

#### Scenario: Stale notices fail CI
- **WHEN** a pull request upgrades a bundled crate without regenerating `THIRD_PARTY_NOTICES`
- **THEN** the license check step fails and the `ci` check fails

### Requirement: Conformance job
CI SHALL run both conformance suites (conformance-testing) on Linux arm64 with `OXGL_BACKEND=software`, judged against the checked-in expectations, in one or more jobs that build the package first. Every such job SHALL be required by the aggregate `ci` check and SHALL upload its results report as a workflow artifact whether it passes or fails.

#### Scenario: Conformance regression fails CI
- **WHEN** a pull request makes a conformance page that is expected to pass fail
- **THEN** the conformance job fails, naming the page, and the `ci` check fails

#### Scenario: Report available after failure
- **WHEN** the conformance job fails
- **THEN** the run's results report can be downloaded from the workflow run

#### Scenario: Suite cached by pin
- **WHEN** the pinned suite commit is unchanged since a run on `main`
- **THEN** the job restores the suite from a cache keyed by that commit instead of fetching it
