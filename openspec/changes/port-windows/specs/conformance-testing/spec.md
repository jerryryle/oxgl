## MODIFIED Requirements

### Requirement: Page outcome
Each page run SHALL have exactly one outcome, taken from the first rule that applies. `CRASH`: its process dies from a signal or abort the runner did not send, even after the page reported, or does not exit 30 s after completing. `FAIL`: a script error escapes in a page that ends early on errors. `TIMEOUT`: it goes the time limit without a new result. `FAIL`: it completes with a failing result or no results. `PASS`: it completes with at least one result, all succeeding.

#### Scenario: Uncaught exception in a page expected to fail
- **WHEN** a page whose expectation is `FAIL` calls a WebGL method oxgl does not implement and the resulting `TypeError` is not caught by the page
- **THEN** the page's outcome is `FAIL`, the exception message is recorded, and the page ends at once rather than waiting out the time limit

#### Scenario: Uncaught exception in a page expected to pass
- **WHEN** a page with no expectations entry throws an uncaught error and then never completes
- **THEN** the page keeps running until the time limit, its outcome is `TIMEOUT`, and the error message is recorded

#### Scenario: Page recovers from an uncaught exception
- **WHEN** a page with no expectations entry throws an uncaught error from a callback and its main script then completes with only passing results
- **THEN** the page's outcome is `PASS`, as in the official harness

#### Scenario: Every page ends early on errors
- **WHEN** a run asks for every page to end early on errors and a page with no expectations entry throws an uncaught error
- **THEN** the page's outcome is `FAIL` and it ends at once

#### Scenario: Page never finishes
- **WHEN** a page waits on a promise that never settles and so never signals completion
- **THEN** its outcome is `TIMEOUT` after the time limit and the run continues with the next page

#### Scenario: Crash after reporting
- **WHEN** a page reports only passing results and completes, and the process then aborts while destroying its contexts
- **THEN** the page's outcome is `CRASH`

#### Scenario: Hang while tearing down
- **WHEN** a page completes with only passing results and its process then hangs while destroying its contexts
- **THEN** the runner kills the process 30 seconds later and the page's outcome is `CRASH`, not `TIMEOUT` or `PASS`

#### Scenario: Long page that keeps reporting
- **WHEN** a page reports results steadily and takes longer in total than the time limit, never going the time limit without a new result
- **THEN** it is not timed out, and its outcome follows from its results

#### Scenario: Runner stops a hung page
- **WHEN** the runner kills a page's process at the time limit
- **THEN** the page's outcome is `TIMEOUT`, not `CRASH`

#### Scenario: Node abort on Windows
- **WHEN** a page's process calls `process.abort()` on Windows, where Node exits with code 134 instead of raising a signal
- **THEN** the page's outcome is `CRASH`, not a harness error

### Requirement: Checked-in expectations
The repository SHALL contain an expectations file listing every page, per suite, whose expected outcome is not `PASS`. Each entry SHALL give the suite, the page path relative to `sdk/tests`, one of `FAIL`, `TIMEOUT`, `CRASH` or `SKIP`, optionally the platforms it applies to (`linux-x64`, `linux-arm64`, `macos-arm64`, `windows-x64`, `windows-arm64`), and a non-empty reason. An entry without platforms SHALL apply on every platform; an entry with platforms SHALL apply only on those, and elsewhere the page SHALL be judged as if it had no entry. A page MAY have several entries in a suite when each lists platforms and no platform is in two of them; an entry without platforms SHALL be the page's only entry in its suite. A page without an entry that applies is expected to `PASS`. A `SKIP` page SHALL NOT be run unless the developer asks for skipped pages to be included. When included, its outcome SHALL be reported but not judged. An update run SHALL treat an entry without platforms as listing all five, and SHALL write an entry that lists all five without platforms. It SHALL leave `SKIP` entries, and entries that do not apply on its platform, unchanged. For a page whose entry with platforms applies, it SHALL remove the run's platform from that entry when the page passes or has a different outcome, removing the entry when no platform remains. When the page then has a non-`PASS` outcome and no entry applies, it SHALL add the run's platform to the page's entry with that outcome if one exists, otherwise add an entry for the run's platform alone if the page has entries with platforms, and otherwise add an entry without platforms.

#### Scenario: Entry without a reason
- **WHEN** the expectations file contains an entry with no reason
- **THEN** the conformance command fails before running any page and names the entry

#### Scenario: Skipped page
- **WHEN** a page is listed as `SKIP` and the developer does not ask to include skipped pages
- **THEN** the page is not run and is reported as skipped

#### Scenario: Skipped pages included
- **WHEN** the developer includes skipped pages and a `SKIP` page times out again or now passes
- **THEN** the report shows its outcome, and the run's success is unaffected by it

#### Scenario: Entry limited to other platforms
- **WHEN** a page's entry is `FAIL` for `linux-x64` and `windows-x64`, and the page passes on Linux arm64
- **THEN** the page has its expected outcome there, and the entry is neither reported stale nor changed by an update run

#### Scenario: Entry limited to this platform
- **WHEN** a page's entry is `FAIL` for `linux-x64` and `windows-x64`, and the page fails on Linux x64
- **THEN** the page has its expected outcome

#### Scenario: Unknown platform
- **WHEN** an entry names a platform that is not one of the five
- **THEN** the conformance command fails before running any page and names the entry

#### Scenario: Different outcomes on different platforms
- **WHEN** a page has a `FAIL` entry for `linux-x64` and a `TIMEOUT` entry for `macos-arm64`
- **THEN** a run on each of those platforms expects that platform's outcome, and a run elsewhere expects `PASS`

#### Scenario: Overlapping entries
- **WHEN** a page has two entries in one suite whose platform lists share a platform, or an entry without platforms and another entry
- **THEN** the conformance command fails before running any page and names the entries

#### Scenario: Update after a platform starts failing
- **WHEN** an update run on macOS arm64 finds that a page fails whose only entry is `FAIL` for `linux-x64` and `windows-x64`
- **THEN** the entry is rewritten as `FAIL` for `linux-x64`, `windows-x64` and `macos-arm64`

#### Scenario: Update on one platform keeps an entry for the others
- **WHEN** an update run on macOS arm64 finds that a page passes whose entry is `FAIL` without platforms
- **THEN** the entry is rewritten as `FAIL` for `linux-x64`, `linux-arm64`, `windows-x64` and `windows-arm64`

#### Scenario: Update after a platform starts passing
- **WHEN** an update run on Windows x64 finds that a page passes whose entry is `FAIL` for `linux-x64` and `windows-x64`
- **THEN** the entry is rewritten as `FAIL` for `linux-x64` only

### Requirement: Conformance command
The root `package.json` SHALL expose `npm run conformance`, which runs both suites against the built package and exits non-zero when the run fails. It SHALL accept options to select one suite, to restrict the run to pages whose path contains a given substring, to include `SKIP` pages, to make every page end early on errors (Page outcome), and to rewrite the expectations file from the run's outcomes. A filtered run SHALL judge only the pages it ran.

#### Scenario: Filtered run
- **WHEN** a developer runs the command restricted to `conformance/buffers/`
- **THEN** only pages under that directory run, and expectations for other pages are neither checked nor reported stale

#### Scenario: Updating expectations
- **WHEN** a developer runs the command with the update option
- **THEN** the run is judged against the expectations it writes, the entries for the pages that ran are rewritten from their outcomes on the run's platform as Checked-in expectations requires, existing reasons are kept for entries whose outcome is unchanged, on a run of whole suites entries for pages those suites no longer contain are removed, and new or changed entries take the page's first escaped error as their reason, or its first failure message when it has none (for `TIMEOUT` and `CRASH`, `no new result within the time limit` / `crashed`, followed by the first escaped error's message when there is one), reduced to its first line and at most 200 characters; the command then exits zero unless the expectations file could not be parsed or a page had a harness error
