# Spec Delta

## MODIFIED Requirements

### Requirement: Triggers
CI SHALL run on every pull request targeting `main` and every push to `main`, and SHALL cancel superseded runs for the same pull request. The jobs that build or test oxgl SHALL be skipped when every changed file is on the repository's skip list, which SHALL name only files no build, test or lint step reads, and SHALL run otherwise, including when the changed files cannot be determined. Workflow lint and the repository checks SHALL run on every change.

#### Scenario: Pull request opened
- **WHEN** a pull request targeting `main` is opened or updated
- **THEN** the CI workflow runs against its head commit and any earlier run for that pull request is cancelled

#### Scenario: Documentation-only change
- **WHEN** a pull request changes only `README.md` and files under `openspec/`
- **THEN** workflow lint and the repository checks run, the jobs that build or test oxgl (the Rust and Node checks, the Node version range, AddressSanitizer, conformance and the optional GPU job) are skipped, and the `ci` check passes

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
