# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Triggers
**Reason**: Which jobs run now depends on the event, not on which files changed. The skip list, the page-only classification and the changed-files comparison are gone.
**Migration**: See "Events and job sets", "Pull requests run the quick checks" and "The merge queue runs the full checks".

### Requirement: Aggregate status check
**Reason**: With no skip list, the only allowed skips are the full-only jobs on a pull request's quick checks.
**Migration**: See "One aggregate check".

### Requirement: Page-only changes republish from the last full run
**Reason**: The published page belongs to the latest release. A change to the page appears with the next release, and a `full-ci` pull request run gives a preview.
**Migration**: None. Label a pull request `full-ci` to preview a page change.
