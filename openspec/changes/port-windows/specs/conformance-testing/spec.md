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
