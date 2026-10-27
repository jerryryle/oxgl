# Spec Delta

## Purpose

Defines the automated checks every oxgl change must pass before merge: the jobs, platforms, and triggers; what each job verifies; how CI obtains ANGLE; and the security posture of the workflows themselves.

## ADDED Requirements

### Requirement: Triggers
CI SHALL run on every pull request targeting `main` and on every push to `main`, and SHALL cancel superseded runs for the same pull request.

#### Scenario: Pull request opened
- **WHEN** a pull request targeting `main` is opened or updated
- **THEN** the CI workflow runs against its head commit and any earlier run for that pull request is cancelled

### Requirement: Platform matrix
The main CI job SHALL run on Linux x64, macOS arm64, and Windows x64, and a failure on any platform SHALL fail the overall check.

#### Scenario: Windows-only failure
- **WHEN** a change passes on Linux and macOS but a test fails on Windows
- **THEN** the aggregate CI check fails

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
- **THEN** `OXGL_BACKEND` is `software` and clear-then-readPixels and soak tests execute (not skip) on all three platforms

### Requirement: AddressSanitizer job
CI SHALL include a Linux x64 job that builds and runs the Rust test suites, including the SwiftShader integration and soak tests, with AddressSanitizer and LeakSanitizer enabled. Any sanitizer report SHALL fail the job. Leak suppressions SHALL be limited to named third-party components and checked into the repository with a justification for each entry.

#### Scenario: Use-after-free is caught
- **WHEN** a change introduces a use-after-free in oxgl code exercised by the tests
- **THEN** the ASan job fails with an AddressSanitizer report

#### Scenario: Leak in oxgl code is caught
- **WHEN** a change leaks memory allocated by oxgl code in a tested path
- **THEN** the job fails with a LeakSanitizer report not covered by any suppression

### Requirement: ANGLE obtained from the pinned bundle
CI SHALL obtain ANGLE only through the pinned, checksum-verified bundle defined by angle-distribution, MAY cache it keyed by its digest, and SHALL NOT build ANGLE from source.

#### Scenario: Cache keyed by digest
- **WHEN** the ANGLE pin changes
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
