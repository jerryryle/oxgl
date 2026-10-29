# Spec Delta

## MODIFIED Requirements

### Requirement: Conformance command
The root `package.json` SHALL expose `npm run conformance`, which runs both suites against the built package and exits non-zero when the run fails. It SHALL accept options to select one suite, to restrict the run to pages whose path contains a given substring, to include `SKIP` pages, to make every page end early on errors (Page outcome), and to rewrite the expectations file from the run's outcomes. It SHALL accept an option setting how many pages run at once, defaulting to the number of CPUs available to the process (at least one). A filtered run SHALL judge only the pages it ran.

#### Scenario: Filtered run
- **WHEN** a developer runs the command restricted to `conformance/buffers/`
- **THEN** only pages under that directory run, and expectations for other pages are neither checked nor reported stale

#### Scenario: Updating expectations
- **WHEN** a developer runs the command with the update option
- **THEN** the run is judged against the expectations it writes, the expectations entries for the pages that ran are replaced with their outcomes, existing reasons are kept for entries whose outcome is unchanged, entries for pages that now pass are removed, on a run of whole suites entries for pages those suites no longer contain are removed, and new or changed entries take the page's first escaped error as their reason, or its first failure message when it has none (for `TIMEOUT` and `CRASH`, `no new result within the time limit` / `crashed`, followed by the first escaped error's message when there is one), reduced to its first line and at most 200 characters; the command then exits zero unless the expectations file could not be parsed or a page had a harness error


#### Scenario: Default parallelism
- **WHEN** a developer runs the command without the parallelism option on a machine where 4 CPUs are available to the process
- **THEN** up to 4 pages run at once, and the report records 4 as the number of pages run in parallel
