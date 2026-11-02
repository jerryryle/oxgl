# continuous-integration Specification

## Purpose
Defines the automated checks every oxgl change must pass before merge: the jobs, platforms, and triggers; what each job verifies; how CI obtains ANGLE; and the security posture of the workflows themselves.

## Requirements

### Requirement: Triggers
CI SHALL run on every pull request targeting `main` and every push to `main`, and SHALL cancel superseded runs for the same pull request. The jobs that build or test oxgl SHALL be skipped when every changed file is on the repository's skip list or is a results page file (results-page), which SHALL name only files no build, test or lint step reads, and SHALL run otherwise, including when the changed files cannot be determined. Workflow lint and the repository checks SHALL run on every change.

#### Scenario: Pull request opened
- **WHEN** a pull request targeting `main` is opened or updated
- **THEN** the CI workflow runs against its head commit and any earlier run for that pull request is cancelled

#### Scenario: Documentation-only change
- **WHEN** a pull request changes only `README.md` and files under `openspec/`
- **THEN** workflow lint and the repository checks run, the jobs that build or test oxgl (the build, the Rust checks, the Node tests, AddressSanitizer, conformance and the three.js examples) are skipped, and the `ci` check passes

#### Scenario: Skip list holds only unread files
- **WHEN** a reviewer reads the skip list
- **THEN** it names only Markdown documentation, OpenSpec artifacts, agent configuration, repository assets (`assets/`, such as the social card), the license text, editor configuration, and Dependabot's and zizmor's configuration

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

### Requirement: Platform matrix
The main CI job SHALL run on every supported host: Linux x64, Linux arm64, macOS arm64, Windows x64 and Windows arm64 (see node-api). A failure on any of them SHALL fail the overall check.

#### Scenario: Windows-only failure
- **WHEN** a change breaks a test only on Windows arm64
- **THEN** that platform's job fails and the aggregate CI check fails, while host-independent checks, such as workflow lint and license checks, are unaffected

#### Scenario: Disabled platforms are findable
- **WHEN** a maintainer searches the repository's workflows for the `PLATFORM-FOCUS` marker
- **THEN** nothing is found

### Requirement: Rust checks
On each platform, CI SHALL run `cargo fmt --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings` (with the workspace's pedantic configuration), and `cargo test --workspace --exclude oxgl-node --locked` (oxgl-node is a Node addon whose tests run under Node), using the pinned toolchain.

#### Scenario: Pedantic lint fails CI
- **WHEN** a change introduces code that triggers a clippy pedantic lint
- **THEN** the clippy step fails and the CI check fails

#### Scenario: Lockfile drift fails CI
- **WHEN** `Cargo.lock` is out of date with the manifests
- **THEN** CI fails rather than updating the lockfile

### Requirement: Node checks in software mode
On each platform, CI SHALL install dependencies with `npm ci` and run the JS lint and type check. It SHALL run the Node test suite (including the soak test) with `OXGL_BACKEND=software` against that platform's packages from the run's build (Each platform is built once per run), on Node 24 on every platform and on both ends of `engines` on Linux arm64.

#### Scenario: Software rendering on every platform
- **WHEN** the Node test step runs
- **THEN** `OXGL_BACKEND` is `software` and clear-then-readPixels and soak tests execute (not skip) on every platform in the matrix

#### Scenario: Oldest supported Node
- **WHEN** the Node tests run on Linux arm64 on Node 22.22.2
- **THEN** they use the same Linux arm64 packages as the Node 24 leg, and pass

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

### Requirement: License check
CI SHALL run the project's license check on every pull request: dependency licenses against the allowlist, and `THIRD_PARTY_NOTICES` against the current dependency graph. A failure SHALL fail the aggregate `ci` check.

#### Scenario: Stale notices fail CI
- **WHEN** a pull request upgrades a bundled crate without regenerating `THIRD_PARTY_NOTICES`
- **THEN** the license check step fails and the `ci` check fails

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

### Requirement: Results page is built on every suite run
Whenever the conformance and three.js jobs run, CI SHALL build the results page (results-page) from the reports they uploaded, also when some of them failed or uploaded nothing, and SHALL upload the page as a run artifact. A missing report SHALL show as "not run" for its platform and suite. The page build SHALL NOT be part of the aggregate `ci` check.

#### Scenario: Conformance regression on one platform
- **WHEN** a pull request makes a conformance page fail on Windows x64
- **THEN** the conformance job fails, and the run still uploads a results page whose windows-x64 cell for that page reads `FAIL` with the failure message

#### Scenario: A job that uploaded nothing
- **WHEN** the macOS arm64 webgl2 conformance job fails before writing its report
- **THEN** the results page is still built, every webgl2 row shows "not run" under macos-arm64, and the webgl2 section says it has no report from macos-arm64

#### Scenario: Documentation-only change
- **WHEN** a pull request changes only files on the skip list, so the suites don't run
- **THEN** no results page is built

### Requirement: Results page is deployed from main only
CI SHALL deploy the results page to GitHub Pages only from runs on `main`, in a job of its own that alone holds the `pages: write` and `id-token: write` permissions. Pull request runs SHALL NOT deploy.

#### Scenario: Push to main
- **WHEN** a push to `main` runs the suites
- **THEN** the page built from that run's reports is published at the repository's GitHub Pages URL

#### Scenario: Pull request
- **WHEN** CI runs for a pull request
- **THEN** the page is built and uploaded as an artifact, and the deploy job does not run

### Requirement: Page-only changes republish from the last full run
A results page file is the template, the builder or the builder's tests. For a change whose files are all results page files or on the skip list, with at least one results page file, CI SHALL lint and test the builder in the repository checks, and SHALL build the page from the reports of the latest `main` run that uploaded them. On `main` it SHALL deploy that page. When no such run's reports are still available, it SHALL deploy nothing and say why in the log.

#### Scenario: Template change on main
- **WHEN** a push to `main` changes only `scripts/results-page.html`
- **THEN** no build or test job runs, the builder's lint and tests run, and the page is rebuilt from the latest `main` run's reports and deployed

#### Scenario: Page-only pull request
- **WHEN** a pull request changes only `scripts/results-page.mjs` and `test/results-page.test.mjs`
- **THEN** the builder's lint and tests run, a preview page built from the latest `main` run's reports is uploaded as an artifact, and nothing is deployed

#### Scenario: Reports expired
- **WHEN** a page-only push to `main` finds no `main` run whose reports are still available
- **THEN** the page job deploys nothing, the published page stays as it was, and the log says no reports were available

#### Scenario: Generator change that needs new report fields
- **WHEN** a change touches `scripts/results-page.mjs` and `conformance/run.mjs`
- **THEN** it is not page-only, and every job runs

### Requirement: Manual runs
CI SHALL also run when started manually (`workflow_dispatch`) on any branch, running every job against the branch's head commit, as when the changed files cannot be determined. A manual run SHALL cancel an earlier one still in progress on the same branch, except on `main`, where every run completes.

#### Scenario: Manual run
- **WHEN** CI is started manually on a branch
- **THEN** every job runs against the branch's head commit, the `ci` check is reported on that commit, and an earlier manual run still in progress on that branch is cancelled unless the branch is `main`

### Requirement: Packed packages are smoke-tested
On each supported platform, CI SHALL pack `@oxgl-js/oxgl` and that platform's package with `npm pack`, and install both tarballs into an empty project outside the repository. It SHALL then import the package there and render with `backend: 'software'`. A failure SHALL fail the `ci` check. Each platform's build job SHALL keep its platform tarball as a run artifact, and exactly one designated build job SHALL also keep its `@oxgl-js/oxgl` tarball.

#### Scenario: Packaging mistake caught
- **WHEN** a pull request leaves the ANGLE libraries out of a platform package's file list
- **THEN** that platform's smoke test fails at import with `OXGL_NATIVE_MISSING`, and the `ci` check fails

#### Scenario: Test runs against the tarballs
- **WHEN** the smoke test runs
- **THEN** it resolves `@oxgl-js/oxgl` and the platform package from the empty project's `node_modules`, not from the repository's `dist/`, and a context created with `backend: 'software'` clears and reads back the clear color

### Requirement: Each platform is built once per run
In each run, CI SHALL build and pack oxgl once per supported platform, in one build job per platform, and SHALL upload that platform's packages as a run artifact. Every job that runs oxgl's Node tests, conformance suites or three.js examples SHALL run them against those packages, unpacked into `dist/`, and SHALL NOT build the addon itself. The `@oxgl-js/oxgl` package every such job uses SHALL be the single one the run keeps for the release.

#### Scenario: Tests judge the packed files
- **WHEN** the macOS arm64 conformance job runs
- **THEN** its `dist/` holds exactly the files of the run's `@oxgl-js/oxgl` tarball and the macOS arm64 build job's `@oxgl-js/darwin-arm64` tarball, and the job compiles no Rust

#### Scenario: Build failure on one platform
- **WHEN** the Windows x64 build fails
- **THEN** no job that tests the run's packages runs, on any platform, since the run has no complete set of packages, and the `ci` check fails

#### Scenario: Packages kept on every run
- **WHEN** a pull request's run finishes
- **THEN** each platform's packages can be downloaded from the run, whether or not the run releases
