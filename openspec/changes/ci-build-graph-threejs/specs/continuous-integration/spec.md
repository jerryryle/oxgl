## ADDED Requirements

### Requirement: Each platform is built once per run
In each run, CI SHALL build and pack oxgl once per supported platform, in one build job per platform, and SHALL upload that platform's packages as a run artifact. Every job that runs oxgl's Node tests, conformance suites, three.js examples or GPU tests SHALL run them against those packages, unpacked into `dist/`, and SHALL NOT build the addon itself. The `@oxgl-js/oxgl` package every such job uses SHALL be the single one the run keeps for the release.

#### Scenario: Tests judge the packed files
- **WHEN** the macOS arm64 conformance job runs
- **THEN** its `dist/` holds exactly the files of the run's `@oxgl-js/oxgl` tarball and the macOS arm64 build job's `@oxgl-js/darwin-arm64` tarball, and the job compiles no Rust

#### Scenario: Build failure on one platform
- **WHEN** the Windows x64 build fails
- **THEN** no job that tests the run's packages runs, on any platform, since the run has no complete set of packages, and the `ci` check fails

#### Scenario: Packages kept on every run
- **WHEN** a pull request's run finishes
- **THEN** each platform's packages can be downloaded from the run, whether or not the run releases

## MODIFIED Requirements

### Requirement: Triggers
CI SHALL run on every pull request targeting `main` and every push to `main`, and SHALL cancel superseded runs for the same pull request. The jobs that build or test oxgl SHALL be skipped when every changed file is on the repository's skip list or is a results page file (results-page), which SHALL name only files no build, test or lint step reads, and SHALL run otherwise, including when the changed files cannot be determined. Workflow lint and the repository checks SHALL run on every change.

#### Scenario: Pull request opened
- **WHEN** a pull request targeting `main` is opened or updated
- **THEN** the CI workflow runs against its head commit and any earlier run for that pull request is cancelled

#### Scenario: Documentation-only change
- **WHEN** a pull request changes only `README.md` and files under `openspec/`
- **THEN** workflow lint and the repository checks run, the jobs that build or test oxgl (the build, the Rust checks, the Node tests, AddressSanitizer, conformance, the three.js examples and the optional GPU job) are skipped, and the `ci` check passes

#### Scenario: Skip list holds only unread files
- **WHEN** a reviewer reads the skip list
- **THEN** it names only Markdown documentation, OpenSpec artifacts, agent configuration, repository assets (`assets/`, such as the social card), the license text, editor configuration and the workflow linters' configuration

#### Scenario: Asset-only change
- **WHEN** a pull request changes only files under `assets/`
- **THEN** workflow lint and the repository checks run, the jobs that build or test oxgl are skipped, and the `ci` check passes

#### Scenario: Code change runs everything
- **WHEN** a pull request changes `README.md` and one file under `crates/`
- **THEN** every job runs

#### Scenario: New path runs everything
- **WHEN** a pull request adds a file in a directory the list does not name
- **THEN** every job runs

#### Scenario: Push to main
- **WHEN** a push to `main` changes only files on the list
- **THEN** the jobs that build or test oxgl are skipped; when it changes any other file, or the pushed range cannot be compared, every job runs

#### Scenario: Page-only change
- **WHEN** a pull request changes only `scripts/results-page.html` and `README.md`
- **THEN** the jobs that build or test oxgl are skipped, the results page's own checks run, and the `ci` check passes when they pass

### Requirement: Node checks in software mode
On each platform, CI SHALL install dependencies with `npm ci` and run the JS lint and type check. It SHALL run the Node test suite (including the soak test) with `OXGL_BACKEND=software` against that platform's packages from the run's build (Each platform is built once per run), on Node 24 on every platform and on both ends of `engines` on Linux arm64.

#### Scenario: Software rendering on every platform
- **WHEN** the Node test step runs
- **THEN** `OXGL_BACKEND` is `software` and clear-then-readPixels and soak tests execute (not skip) on every platform in the matrix

#### Scenario: Oldest supported Node
- **WHEN** the Node tests run on Linux arm64 on Node 22.22.2
- **THEN** they use the same Linux arm64 packages as the Node 24 leg, and pass

### Requirement: Aggregate status check
CI SHALL expose a single aggregate check named `ci` that succeeds only when every required job succeeds, so branch protection can require one stable check name as jobs evolve. A job that builds or tests oxgl and was skipped because the change touches only listed paths (see Triggers) SHALL count as succeeding. A skip for any other reason SHALL NOT.

#### Scenario: Skipped required job
- **WHEN** a required job is cancelled or skipped due to an upstream failure
- **THEN** the `ci` check reports failure

#### Scenario: Skipped for a documentation-only change
- **WHEN** the jobs that build or test oxgl are skipped because every changed file is on the list
- **THEN** the `ci` check succeeds if workflow lint and the repository checks succeeded

#### Scenario: Change detection fails
- **WHEN** the job that determines the changed files fails
- **THEN** the `ci` check reports failure

#### Scenario: Tests skipped after a failed build
- **WHEN** the build fails on one platform, so the Node tests, conformance and three.js jobs are skipped
- **THEN** the `ci` check reports failure

### Requirement: Conformance job
CI SHALL run both conformance suites (conformance-testing) on every supported platform (Linux x64, Linux arm64, macOS arm64, Windows x64 and Windows arm64) with `OXGL_BACKEND=software`, each judged against the checked-in expectations that apply on that platform, against that platform's packages from the run's build. Every such job SHALL be required by the aggregate `ci` check and SHALL upload its results report, named by runner and suite, as a workflow artifact whether it passes or fails.

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

### Requirement: three.js examples job
CI SHALL run the three.js example suite (threejs-examples) on every supported platform with `OXGL_BACKEND=software`, each judged against the checked-in expectations that apply on that platform, against that platform's packages from the run's build. Every such job SHALL be required by the aggregate `ci` check, skipped as the other heavy jobs are, and SHALL upload its report and output images, named by runner, as workflow artifacts whether it passes or fails.

#### Scenario: Example regression fails CI
- **WHEN** a pull request makes an example that is expected to pass render a frame that does not match its reference
- **THEN** the three.js job fails, naming the example, and the `ci` check fails

#### Scenario: Platform-only example regression
- **WHEN** a pull request makes an example fail on macOS arm64 only
- **THEN** that platform's three.js job fails, naming the example, and the `ci` check fails

#### Scenario: Images available after failure
- **WHEN** the three.js job fails
- **THEN** the report and the failing examples' captured, reference and diff images can be downloaded from the workflow run

#### Scenario: Release cached by pin
- **WHEN** the pinned three.js commit is unchanged since a run on `main`
- **THEN** the job restores the release from a cache keyed by that commit instead of fetching it

### Requirement: Packed packages are smoke-tested
On each supported platform, CI SHALL pack `@oxgl-js/oxgl` and that platform's package with `npm pack`, and install both tarballs into an empty project outside the repository. It SHALL then import the package there and render with `backend: 'software'`. A failure SHALL fail the `ci` check. Each platform's build job SHALL keep its platform tarball as a run artifact, and exactly one designated build job SHALL also keep its `@oxgl-js/oxgl` tarball.

#### Scenario: Packaging mistake caught
- **WHEN** a pull request leaves the ANGLE libraries out of a platform package's file list
- **THEN** that platform's smoke test fails at import with `OXGL_NATIVE_MISSING`, and the `ci` check fails

#### Scenario: Test runs against the tarballs
- **WHEN** the smoke test runs
- **THEN** it resolves `@oxgl-js/oxgl` and the platform package from the empty project's `node_modules`, not from the repository's `dist/`, and a context created with `backend: 'software'` clears and reads back the clear color
