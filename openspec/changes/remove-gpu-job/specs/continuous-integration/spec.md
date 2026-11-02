## MODIFIED Requirements

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
