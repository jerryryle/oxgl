# Spec Delta

## ADDED Requirements

### Requirement: Conformance job
CI SHALL run both conformance suites (conformance-testing) on Linux arm64 with `OXGL_BACKEND=software`, judged against the checked-in expectations, in one or more jobs that build the package first. Every such job SHALL be required by the aggregate `ci` check and SHALL upload its results report as a workflow artifact whether it passes or fails.

#### Scenario: Conformance regression fails CI
- **WHEN** a pull request makes a conformance page that is expected to pass fail
- **THEN** the conformance job fails, naming the page, and the `ci` check fails

#### Scenario: Report available after failure
- **WHEN** the conformance job fails
- **THEN** the run's results report can be downloaded from the workflow run

#### Scenario: Suite cached by pin
- **WHEN** the pinned suite commit is unchanged since a run on `main`
- **THEN** the job restores the suite from a cache keyed by that commit instead of fetching it
