# Spec Delta

## MODIFIED Requirements

### Requirement: Platform matrix
The main CI job SHALL run on Linux arm64, the only supported platform during the Linux arm64 focus (see node-api), and a failure SHALL fail the overall check. The other platforms' job entries SHALL remain in the workflow, disabled and marked so they can be found and restored.

#### Scenario: Windows-only failure
- **WHEN** CI runs during the Linux arm64 focus
- **THEN** no job that builds or tests oxgl runs on Windows, macOS or Linux x64, a test failure on Linux arm64 fails the aggregate CI check, and the disabled platforms' entries are present behind the `PLATFORM-FOCUS` marker. Host-independent checks, such as workflow lint and license checks, and the ANGLE build workflow are unaffected.

#### Scenario: Disabled platforms are findable
- **WHEN** a maintainer searches the CI workflow for the `PLATFORM-FOCUS` marker
- **THEN** every disabled matrix entry and runner for Linux x64, macOS arm64 and Windows x64 is found next to it

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
