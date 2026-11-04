# continuous-integration Specification

## Purpose
Defines the automated checks every oxgl change must pass before merge: the jobs, platforms, and triggers; what each job verifies; how CI obtains ANGLE; and the security posture of the workflows themselves.

## Requirements

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
CI SHALL run the three.js example suite (threejs-examples) on every supported platform with `OXGL_BACKEND=software`, each judged against the checked-in expectations that apply on that platform, against that platform's packages from the run's build. Every such job SHALL be required by the aggregate `ci` check whenever the run includes the full checks (see "Events and job sets"), and SHALL upload its report and output images, named by runner, as workflow artifacts whether it passes or fails.

#### Scenario: Example regression fails CI
- **WHEN** a pull request makes an example that is expected to pass render a frame that does not match its reference
- **THEN** the three.js job fails in its merge group run, naming the example, and the `ci` check fails

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
- **WHEN** a pull request without the `full-ci` label changes only documentation, so its run is the quick checks and the suites don't run
- **THEN** no results page is built

### Requirement: Results page is deployed from main only
CI SHALL deploy the results page to GitHub Pages only from a run on `main` that released a version, in a job of its own that alone holds the `pages: write` and `id-token: write` permissions, and SHALL deploy the page built from the reports of the run whose packages it published. Pull request and merge group runs SHALL NOT deploy. A change to the page's template or builder SHALL appear on the published page with the next release.

#### Scenario: Push to main
- **WHEN** a push to `main` publishes version `0.2.3` from the merge group run that tested it
- **THEN** the page built from that merge group run's reports is published at the repository's GitHub Pages URL

#### Scenario: Change that doesn't release
- **WHEN** a push to `main` lands a change, such as an edit to `scripts/results-page.html`, while the version is already on npm
- **THEN** nothing is deployed and the published page stays as it was until the next release

#### Scenario: Pull request
- **WHEN** CI runs for a pull request or a merge group
- **THEN** any page built is uploaded as an artifact, and the deploy job does not run

### Requirement: Manual runs
CI SHALL also run when started manually (`workflow_dispatch`) on any branch, running the full checks against the branch's head commit. A manual run on `main` SHALL also release as a merge group's commit does (release, "A new version on main is released"). A manual run SHALL cancel an earlier one still in progress on the same branch, except on `main`, where every run completes.

#### Scenario: Manual run
- **WHEN** CI is started manually on a branch other than `main`
- **THEN** every job runs against the branch's head commit, the `ci` check is reported on that commit, nothing is released, and an earlier manual run still in progress on that branch is cancelled

#### Scenario: Manual run on main after a bypass merge
- **WHEN** a pull request was merged past the queue, `main`'s version is not on npm, and CI is started manually on `main`
- **THEN** every job runs, and when `ci` passes the version is published from that run's packages

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

### Requirement: Events and job sets
CI SHALL run on every pull request targeting `main`, every merge group of its merge queue, every push to `main` and every manual run, cancelling only superseded runs of a pull request or of manual runs off `main`. A pull request runs the quick checks, a merge group the full checks, and a push to `main` publishes what the merge group run for its commit produced, building only to warm caches. Which build and test jobs run SHALL NOT depend on which files changed.

#### Scenario: Pull request opened
- **WHEN** a pull request targeting `main` is opened or updated
- **THEN** the quick checks run against its head commit and any earlier run for that pull request is cancelled

#### Scenario: Documentation pull request
- **WHEN** a pull request changes only `README.md`
- **THEN** the same quick checks run as for a code change, and its merge group runs the full checks

#### Scenario: Push to main
- **WHEN** a push to `main` lands a merge group's commit that changes no file a cache is keyed on
- **THEN** no job that builds or tests oxgl runs, and the run releases or deploys only what that merge group's run produced (release, "A new version on main is released")

### Requirement: Pull requests run the quick checks
A pull request's run SHALL run workflow lint, the repository checks, the Rust checks, the build with its packed-package smoke test, and the Node tests, on every platform. It SHALL skip AddressSanitizer, conformance, the three.js examples and the results page, unless the pull request carries the `full-ci` label, in which case it SHALL run the full checks. Adding or removing a label SHALL start no run; a manual run on the branch gives the full checks at once.

#### Scenario: Code change on a pull request
- **WHEN** a pull request without the `full-ci` label changes a file under `crates/`
- **THEN** the Rust checks, builds, smoke tests and Node tests run on all five platforms, and no conformance, three.js or AddressSanitizer job runs

#### Scenario: Another label added
- **WHEN** a label is added to a pull request whose quick checks are running
- **THEN** no run starts and the running one continues

#### Scenario: Full checks on request
- **WHEN** a pull request labelled `full-ci` is updated
- **THEN** its run includes AddressSanitizer, both conformance suites and the three.js examples on every platform, and builds a results page artifact

### Requirement: The merge queue runs the full checks
The `main` branch SHALL accept changes through a merge queue that requires the `ci` check. Each merge group's run SHALL run every job against the group's commit, which is the commit that lands on `main`, and when the version in `package.json` is not on npm SHALL keep each platform's packages and every suite's report as run artifacts for at least 7 days, for the release.

#### Scenario: Pull request queued
- **WHEN** a pull request whose quick checks passed is added to the merge queue
- **THEN** a run on the merge group's commit runs AddressSanitizer, conformance and the three.js examples along with the quick checks, and the pull request lands only if `ci` passes there

#### Scenario: Queue run fails
- **WHEN** a merge group's conformance job fails
- **THEN** the pull request is removed from the queue and nothing lands

### Requirement: One aggregate check
CI SHALL expose a single aggregate check named `ci`, required by branch protection and the merge queue, that succeeds only when every job the run's event needs succeeds (see "Events and job sets"). On a pull request's quick checks, the full-only jobs (AddressSanitizer, conformance, the three.js examples) count as succeeding when skipped. Any other skipped, cancelled or failed job SHALL fail the check.

#### Scenario: Quick checks pass
- **WHEN** a pull request without `full-ci` passes every quick check and skips the full-only jobs
- **THEN** the `ci` check succeeds

#### Scenario: Full check skipped in a merge group
- **WHEN** a merge group run skips a conformance job
- **THEN** the `ci` check reports failure

#### Scenario: Tests skipped after a failed build
- **WHEN** the build fails on one platform, so the Node tests, conformance and three.js jobs are skipped
- **THEN** the `ci` check reports failure

### Requirement: Caches are warmed from main
Because caches a merge group or pull request run saves aren't visible to later runs, a push to `main` that changes a file a cache is keyed on, and a manual run on `main`, SHALL save on each platform every cache the checks restore whose key isn't saved yet: the downloads (ANGLE bundles with their symbols, the conformance suite, three.js, Cargo and npm) and the Rust build caches. Other pushes SHALL start no cache job.

#### Scenario: New bundle pinned
- **WHEN** a push to `main` lands a change to `angle/bundles.toml`
- **THEN** the run saves each platform's new bundle cache, and the next merge group run restores the bundles instead of downloading them

#### Scenario: Lockfile changed
- **WHEN** a push to `main` lands a change to `Cargo.lock`
- **THEN** the run's build, check and AddressSanitizer jobs run only to save their build caches for the new key, publish nothing, and the next merge group run's builds start from them instead of compiling from scratch

#### Scenario: Nothing changed
- **WHEN** a push to `main` lands a change that touches none of the files the cache keys are computed from
- **THEN** no cache job runs

#### Scenario: Cold start
- **WHEN** the caches on `main` have been evicted and CI is started manually on `main`
- **THEN** that run saves every platform's input caches

### Requirement: Bot identity
Pull requests and cross-repository dispatches made by automation SHALL use a short-lived installation token of the `oxgl-js` organization's GitHub App, created in the step just before it is used, so their pull requests start CI like any other. No personal access token SHALL be stored. Releases and package publishing SHALL NOT use the App's token.

#### Scenario: Bump pull request starts CI
- **WHEN** the bump workflow opens a pull request
- **THEN** CI runs for it on the `pull_request` event without anyone approving the run

#### Scenario: Token created where it's used
- **WHEN** the workflow logs are read
- **THEN** every App token is created in the job that uses it, immediately before the step that uses it
