# Spec Delta

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
