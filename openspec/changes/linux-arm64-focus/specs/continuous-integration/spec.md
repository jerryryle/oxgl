# Spec Delta

## MODIFIED Requirements

### Requirement: Platform matrix
The main CI job SHALL run on every supported host: Linux x64, Linux arm64, macOS arm64, Windows x64 and Windows arm64 (see node-api). A failure on any of them SHALL fail the overall check.

#### Scenario: Windows-only failure
- **WHEN** a change breaks a test only on Windows arm64
- **THEN** that platform's job fails and the aggregate CI check fails, while host-independent checks, such as workflow lint and license checks, are unaffected

#### Scenario: Disabled platforms are findable
- **WHEN** a maintainer searches the repository's workflows for the `PLATFORM-FOCUS` marker
- **THEN** nothing is found

### Requirement: Node checks in software mode
On each platform, CI SHALL install dependencies with `npm ci`, run the JS lint and type check, build the native addon and package, and run the Node test suite (including the soak test) with `OXGL_BACKEND=software`.

#### Scenario: Software rendering on every platform
- **WHEN** the Node test step runs
- **THEN** `OXGL_BACKEND` is `software` and clear-then-readPixels and soak tests execute (not skip) on every platform in the matrix

### Requirement: AddressSanitizer job
CI SHALL include Linux arm64 and Linux x64 jobs that build and run the Rust test suites, including the SwiftShader integration and soak tests, with AddressSanitizer and LeakSanitizer enabled. Any sanitizer report SHALL fail the job.

#### Scenario: Use-after-free is caught
- **WHEN** a change introduces a use-after-free in oxgl code exercised by the tests
- **THEN** the ASan jobs fail with an AddressSanitizer report

#### Scenario: Leak in oxgl code is caught
- **WHEN** a change leaks memory allocated by oxgl code in a tested path
- **THEN** the jobs fail with a LeakSanitizer report not covered by any suppression

### Requirement: Leak suppressions are narrow
Leak suppressions SHALL name internal functions of a third-party component that make one-time allocations (process-lifetime caches, static initialization) or per-thread allocations the component never frees by design. They SHALL NOT name a library or an exported EGL/GL/Vulkan entry point, and SHALL be checked into the repository with a justification for each entry.

#### Scenario: Broad suppression is rejected in review
- **WHEN** a pull request adds a suppression naming `libGLESv2` or `eglInitialize`
- **THEN** it does not meet this requirement, because it would hide every unreachable allocation made under that library or entry point

#### Scenario: ANGLE per-thread state is suppressed by its internal function
- **WHEN** the ASan job's test threads exit after making EGL calls
- **THEN** ANGLE's per-thread state allocated under `egl::GetCurrentThread` is suppressed by name, and no other ANGLE allocation is

### Requirement: Conformance job
CI SHALL run both conformance suites (conformance-testing) on every supported platform (Linux x64, Linux arm64, macOS arm64, Windows x64 and Windows arm64) with `OXGL_BACKEND=software`, each judged against the checked-in expectations that apply on that platform, in jobs that build the package first. Every such job SHALL be required by the aggregate `ci` check and SHALL upload its results report, named by runner and suite, as a workflow artifact whether it passes or fails.

#### Scenario: Conformance regression fails CI
- **WHEN** a pull request makes a conformance page that is expected to pass fail
- **THEN** the conformance job fails, naming the page, and the `ci` check fails

#### Scenario: Platform-only conformance regression
- **WHEN** a pull request makes a page crash on Windows arm64 only
- **THEN** that platform's conformance job fails, naming the page, and the `ci` check fails

#### Scenario: Report available after failure
- **WHEN** the conformance job fails
- **THEN** the run's results report can be downloaded from the workflow run

#### Scenario: Suite cached by pin
- **WHEN** the pinned suite commit is unchanged since a run on `main`
- **THEN** the job restores the suite from a cache keyed by that commit instead of fetching it

## ADDED Requirements

### Requirement: Suppressions match unstripped ANGLE libraries
The ASan job SHALL run the tests against the unstripped ANGLE libraries from the platform's pinned symbols archive, so suppressions can match ANGLE-internal functions. The archive SHALL be pinned by URL and SHA-256 next to the bundle and verified before extraction, like the bundle (angle-distribution, Integrity verification).

#### Scenario: Symbols archive with a wrong digest
- **WHEN** the pinned symbols archive's digest does not match the downloaded file
- **THEN** the build fails before anything is extracted, and the ASan job does not run against unverified libraries
