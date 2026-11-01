# Spec Delta

## MODIFIED Requirements

### Requirement: Triggers
CI SHALL run on every pull request targeting `main` and every push to `main`, and SHALL cancel superseded runs for the same pull request. The jobs that build or test oxgl SHALL be skipped when every changed file is on the repository's skip list, which SHALL name only files no build, test or lint step reads, and SHALL run otherwise, including when the changed files cannot be determined. Workflow lint and the repository checks SHALL run on every change.

#### Scenario: Pull request opened
- **WHEN** a pull request targeting `main` is opened or updated
- **THEN** the CI workflow runs against its head commit and any earlier run for that pull request is cancelled

#### Scenario: Documentation-only change
- **WHEN** a pull request changes only `README.md` and files under `openspec/`
- **THEN** workflow lint and the repository checks run, the jobs that build or test oxgl (the Rust and Node checks, the Node version range, AddressSanitizer, conformance, the three.js examples and the optional GPU job) are skipped, and the `ci` check passes

#### Scenario: Skip list holds only unread files
- **WHEN** a reviewer reads the skip list
- **THEN** it names only Markdown documentation, OpenSpec artifacts, agent configuration, the license text, editor configuration and the workflow linters' configuration

#### Scenario: Code change runs everything
- **WHEN** a pull request changes `README.md` and one file under `crates/`
- **THEN** every job runs

#### Scenario: New path runs everything
- **WHEN** a pull request adds a file in a directory the list does not name
- **THEN** every job runs

#### Scenario: Push to main
- **WHEN** a push to `main` changes only files on the list
- **THEN** the jobs that build or test oxgl are skipped; when it changes any other file, or the pushed range cannot be compared, every job runs

## ADDED Requirements

### Requirement: three.js examples job
CI SHALL run the three.js example suite (threejs-examples) on Linux arm64 with `OXGL_BACKEND=software`, judged against the checked-in expectations, in a job that builds the package first. The job SHALL be required by the aggregate `ci` check, skipped as the other heavy jobs are, and SHALL upload its report and output images as workflow artifacts whether it passes or fails.

#### Scenario: Example regression fails CI
- **WHEN** a pull request makes an example that is expected to pass render a frame that does not match its reference
- **THEN** the three.js job fails, naming the example, and the `ci` check fails

#### Scenario: Images available after failure
- **WHEN** the three.js job fails
- **THEN** the report and the failing examples' captured, reference and diff images can be downloaded from the workflow run

#### Scenario: Release cached by pin
- **WHEN** the pinned three.js commit is unchanged since a run on `main`
- **THEN** the job restores the release from a cache keyed by that commit instead of fetching it
