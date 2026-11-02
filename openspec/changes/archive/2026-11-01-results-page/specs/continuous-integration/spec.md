# Spec Delta

## MODIFIED Requirements

### Requirement: Triggers
CI SHALL run on every pull request targeting `main` and every push to `main`, and SHALL cancel superseded runs for the same pull request. The jobs that build or test oxgl SHALL be skipped when every changed file is on the repository's skip list or is a results page file (results-page), which SHALL name only files no build, test or lint step reads, and SHALL run otherwise, including when the changed files cannot be determined. Workflow lint and the repository checks SHALL run on every change.

#### Scenario: Pull request opened
- **WHEN** a pull request targeting `main` is opened or updated
- **THEN** the CI workflow runs against its head commit and any earlier run for that pull request is cancelled

#### Scenario: Documentation-only change
- **WHEN** a pull request changes only `README.md` and files under `openspec/`
- **THEN** workflow lint and the repository checks run, the jobs that build or test oxgl (the Rust and Node checks, the Node version range, AddressSanitizer, conformance, the three.js examples and the optional GPU job) are skipped, and the `ci` check passes

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

## ADDED Requirements

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
