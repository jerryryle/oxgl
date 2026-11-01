# Spec Delta

## MODIFIED Requirements

### Requirement: Triggers
CI SHALL run on every pull request targeting `main`, every push to `main`, and every manual run (`workflow_dispatch`) on any branch, and SHALL cancel superseded runs for the same pull request, or for manual runs on the same branch other than `main`. The jobs that build or test oxgl SHALL be skipped when every changed file is on the repository's skip list, which SHALL name only files no build, test or lint step reads, and SHALL run otherwise, including when the changed files cannot be determined. Workflow lint and the repository checks SHALL run on every change.

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

#### Scenario: Manual run
- **WHEN** CI is started manually on a branch
- **THEN** every job runs against the branch's head commit, the `ci` check is reported on that commit, and an earlier manual run still in progress on that branch is cancelled unless the branch is `main`

## ADDED Requirements

### Requirement: Packed packages are smoke-tested
On each supported platform, CI SHALL pack `oxgl` and that platform's package with `npm pack`, and install both tarballs into an empty project outside the repository. It SHALL then import the package there and render with `backend: 'software'`. A failure SHALL fail the `ci` check. On `main`, when the version is not yet on npm, each platform job SHALL keep its platform tarball as a run artifact for the release, and exactly one designated job SHALL also keep its `oxgl` tarball.

#### Scenario: Packaging mistake caught
- **WHEN** a pull request leaves the ANGLE libraries out of a platform package's file list
- **THEN** that platform's smoke test fails at import with `OXGL_NATIVE_MISSING`, and the `ci` check fails

#### Scenario: Test runs against the tarballs
- **WHEN** the smoke test runs
- **THEN** it resolves `oxgl` and the platform package from the empty project's `node_modules`, not from the repository's `dist/`, and a context created with `backend: 'software'` clears and reads back the clear color
