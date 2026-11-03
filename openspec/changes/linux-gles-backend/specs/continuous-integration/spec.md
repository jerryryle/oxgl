## MODIFIED Requirements

### Requirement: Each platform is built once per run
In each run, CI SHALL build and pack oxgl once per supported platform, in one build job per platform, and SHALL upload that platform's packages as a run artifact. Every job that runs oxgl's Node tests, conformance suites or three.js examples SHALL run them against those packages, unpacked into `dist/`, and SHALL NOT build the addon itself. The one exception is the OpenGL ES backend job, which replaces the Linux x64 addon with the run's `test-gles` build. The `@oxgl-js/oxgl` package every such job uses SHALL be the single one the run keeps for the release. The Linux x64 build job SHALL also build the addon with the Cargo feature `test-gles`, after packing and outside the packed directory, and upload it as a separate artifact, which SHALL NOT be packed into any package or released.

#### Scenario: Tests judge the packed files
- **WHEN** the macOS arm64 conformance job runs
- **THEN** its `dist/` holds exactly the files of the run's `@oxgl-js/oxgl` tarball and the macOS arm64 build job's `@oxgl-js/darwin-arm64` tarball, and the job compiles no Rust

#### Scenario: Build failure on one platform
- **WHEN** the Windows x64 build fails
- **THEN** no job that tests the run's packages runs, on any platform, since the run has no complete set of packages, and the `ci` check fails

#### Scenario: Packages kept on every run
- **WHEN** a pull request's run finishes
- **THEN** each platform's packages can be downloaded from the run, whether or not the run releases

#### Scenario: Test addon never packed
- **WHEN** the Linux x64 build job packs `@oxgl-js/linux-x64-gnu`
- **THEN** the packed addon is the one built without `test-gles`, and with it `OXGL_BACKEND=gles` throws `OXGL_INVALID_BACKEND`

## ADDED Requirements

### Requirement: OpenGL ES backend job
CI SHALL run a job on Linux x64 that installs Mesa's EGL and GL driver packages and unpacks the run's Linux x64 packages, replacing their addon with the `test-gles` build. With `OXGL_BACKEND=gles`, it SHALL then run the Node test suite, both conformance suites and the three.js examples, judged against the expectations for the `linux-x64-gles` platform. It SHALL be one of the full-only jobs: a pull request's quick checks skip it, and the merge queue runs it. A failure SHALL fail the `ci` check.

#### Scenario: GL code path tested on llvmpipe
- **WHEN** the OpenGL ES backend job runs
- **THEN** every context it creates renders through ANGLE's OpenGL ES backend on Mesa's llvmpipe, which the job's log shows in the renderer string

#### Scenario: Regression on the OpenGL ES backend only
- **WHEN** a change breaks a conformance page only on the OpenGL ES backend
- **THEN** the OpenGL ES backend job fails and the `ci` check fails, while the software-backend jobs pass

#### Scenario: Quick checks skip the OpenGL ES backend job
- **WHEN** a pull request without `full-ci` runs the quick checks
- **THEN** the OpenGL ES backend job is skipped and the `ci` check can still succeed
