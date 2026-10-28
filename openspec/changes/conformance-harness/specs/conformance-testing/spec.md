# Spec Delta

## Purpose

Measures oxgl against the Khronos WebGL 1 and WebGL 2 conformance suites under Node, and holds every change to a checked-in record of which conformance pages are expected to pass.

## ADDED Requirements

### Requirement: Pinned conformance suite
The repository SHALL pin one commit of the Khronos WebGL repository (`KhronosGroup/WebGL`) whose `sdk/tests` tree is the suite under test. A run SHALL use only that commit's files, obtained by commit hash. The suite SHALL NOT be committed to the oxgl repository.

#### Scenario: Suite fetched by pinned commit
- **WHEN** a developer runs the conformance command on a clean checkout
- **THEN** it obtains `sdk/tests` at the pinned commit, reuses that copy on later runs, and fetches again only when the pin changes

#### Scenario: Pin changed
- **WHEN** a change updates the pinned commit
- **THEN** the next run uses the new commit's tests, and any resulting differences from the expectations fail the run until the expectations are updated in the same change

### Requirement: WebGL 1 and WebGL 2 suites
The runner SHALL provide two suites, each selected by the suite's own test lists and version filters (`sdk/tests/00_test_list.txt`, `--min-version`/`--max-version`). The `webgl1` suite SHALL run the 1.0.x list with WebGL 1 contexts. The `webgl2` suite SHALL run the 2.0.x list, which includes `conformance/`, with WebGL 2 contexts, as the Khronos harness does for a WebGL 2 run.

#### Scenario: conformance page in both suites
- **WHEN** both suites run
- **THEN** a page under `conformance/` that the version filters admit is run twice, once with WebGL 1 contexts and once with WebGL 2 contexts, and is judged separately in each suite

#### Scenario: conformance2 page only in webgl2
- **WHEN** the `webgl1` suite runs
- **THEN** no page under `conformance2/` is run

### Requirement: Pages obtain oxgl contexts through canvas
Within a page, `getContext` on a canvas element SHALL return an oxgl context for `'webgl'` and `'experimental-webgl'` (WebGL 1) and for `'webgl2'` (WebGL 2), sized to the canvas's `width` and `height` when it is first created. It SHALL return the same context on later calls for that canvas, and `null` for any other context type. The page's global scope SHALL expose oxgl's `WebGLRenderingContext` and `WebGL2RenderingContext`.

#### Scenario: Default canvas size
- **WHEN** a page calls `getContext('webgl')` on a canvas with no size attributes
- **THEN** it receives an oxgl `WebGLRenderingContext` with a 300×150 drawing buffer (cf. Khronos `conformance/canvas/drawingbuffer-test.html`)

#### Scenario: Unsupported context type
- **WHEN** a page calls `getContext('2d')`
- **THEN** it receives `null`, and a page that needs a 2D context fails rather than the runner crashing

### Requirement: Rejected context creation returns null
When oxgl rejects a context creation requested through `getContext`, `getContext` SHALL return `null`, as a browser does when creation fails, and the rejection message SHALL be recorded with the page's results.

#### Scenario: Creation rejected by oxgl
- **WHEN** a page calls `getContext('webgl')` on a 0×0 canvas and oxgl's `createContext` throws
- **THEN** `getContext` returns `null` instead of throwing, and the report's entry for the page includes oxgl's error message

### Requirement: Unsupported media fails promptly
Image, video and audio elements in a page SHALL report a load error shortly after a source is set, instead of never loading, so pages that depend on decoded media fail without waiting for the time limit. The runner SHALL NOT add or change any member of an oxgl context object; pages see oxgl's API as shipped.

#### Scenario: Texture upload from an image
- **WHEN** a page sets an `<img>` source and waits for its load event before uploading a texture
- **THEN** the image fires `error`, and the page fails or reports its own failure well before the time limit

#### Scenario: Member oxgl lacks
- **WHEN** a page reads `gl.canvas` and oxgl does not provide it
- **THEN** the page sees `undefined`, as it would from oxgl outside the runner

### Requirement: Page outcome
Each page run SHALL have exactly one outcome, taken from the first rule that applies. `CRASH`: the process running it dies from a signal or native abort that the runner did not send, even after the page reported. `FAIL`: a script error escapes; the page ends then, without waiting for completion. `TIMEOUT`: it does not complete within the time limit. `FAIL`: it completes with a failing result or no results. `PASS`: it completes with at least one result, all succeeding.

#### Scenario: Uncaught exception
- **WHEN** a page calls a WebGL method oxgl does not implement and the resulting `TypeError` is not caught by the page
- **THEN** the page's outcome is `FAIL`, the exception message is recorded, and the page ends at once rather than waiting out the time limit

#### Scenario: Page never finishes
- **WHEN** a page waits on a promise that never settles and so never signals completion
- **THEN** its outcome is `TIMEOUT` after the time limit and the run continues with the next page

#### Scenario: Crash after reporting
- **WHEN** a page reports only passing results and completes, and the process then aborts while destroying its contexts
- **THEN** the page's outcome is `CRASH`

#### Scenario: Runner stops a hung page
- **WHEN** the runner kills a page's process at the time limit
- **THEN** the page's outcome is `TIMEOUT`, not `CRASH`

### Requirement: Runner errors are not page outcomes
When the runner's own code fails for a page (for example while setting up the page's window or loading it from the runner's server), the run SHALL fail with a harness error naming the page and the error. The other pages SHALL still run and be judged, and the report SHALL still be written. A harness error SHALL NOT be recorded as a page outcome, and the update option SHALL NOT write it to the expectations.

#### Scenario: Page setup fails
- **WHEN** the runner throws while preparing a page, before any page script runs
- **THEN** the run fails reporting a harness error for that page, the page is not recorded as `CRASH` or `FAIL`, and every other page runs and appears in the report

### Requirement: Pages are isolated
Each page SHALL run in its own process with fresh global state. A crash, hang or leaked resource in one page SHALL NOT change another page's outcome or stop the run.

#### Scenario: Native crash in one page
- **WHEN** a page makes the Node process running it abort
- **THEN** that page's outcome is `CRASH`, and every other page runs and is judged normally

### Requirement: Checked-in expectations
The repository SHALL contain an expectations file listing every page, per suite, whose expected outcome is not `PASS`. Each entry SHALL give the suite, the page path relative to `sdk/tests`, one of `FAIL`, `TIMEOUT`, `CRASH` or `SKIP`, and a non-empty reason. A page absent from the file is expected to `PASS`. A `SKIP` page SHALL NOT be run unless the developer asks for skipped pages to be included. When included, its outcome SHALL be reported but not judged.

#### Scenario: Entry without a reason
- **WHEN** the expectations file contains an entry with no reason
- **THEN** the conformance command fails before running any page and names the entry

#### Scenario: Skipped page
- **WHEN** a page is listed as `SKIP` and the developer does not ask to include skipped pages
- **THEN** the page is not run and is reported as skipped

#### Scenario: Skipped pages included
- **WHEN** the developer includes skipped pages and a `SKIP` page times out again or now passes
- **THEN** the report shows its outcome, and the run's success is unaffected by it

### Requirement: Runs are judged against expectations
A run SHALL succeed only when every non-`SKIP` page it ran had its expected outcome. It SHALL fail and name each page that regressed (expected `PASS`, got another outcome), passed unexpectedly, or had a different non-`PASS` outcome than expected. A run of whole suites SHALL also fail when an entry for one of those suites names a page that the suite does not contain.

#### Scenario: Regression
- **WHEN** a change makes a page that was passing fail
- **THEN** the run fails and lists the page with its expected and actual outcomes

#### Scenario: Unexpected pass
- **WHEN** a change makes a page listed as `FAIL` pass
- **THEN** the run fails and names the page, so its entry is removed in the same change

#### Scenario: Stale entry
- **WHEN** the expectations file lists a page that the pinned suite no longer contains
- **THEN** the run fails and names the entry

#### Scenario: Single-suite run
- **WHEN** the developer runs only the `webgl1` suite
- **THEN** entries for `webgl2` are neither judged nor reported stale

### Requirement: Results report
Every run SHALL write a machine-readable report recording, per suite and page, the outcome, the counts of passing and failing results, the duration, and the first failure message or error. The report SHALL also record the suite commit, the requested oxgl backend, the per-page time limit, the number of pages run in parallel, platform and timestamp.

#### Scenario: Report after a failed run
- **WHEN** a run fails because of a regression
- **THEN** the report is still written and contains the regressed page's failure message

### Requirement: Conformance command
The root `package.json` SHALL expose `npm run conformance`, which runs both suites against the built package and exits non-zero when the run fails. A run with the update option SHALL be judged against the expectations it writes. It SHALL accept options to select one suite, to restrict the run to pages whose path contains a given substring, to include `SKIP` pages, and to rewrite the expectations file from the run's outcomes. A filtered run SHALL judge only the pages it ran.

#### Scenario: Filtered run
- **WHEN** a developer runs the command restricted to `conformance/buffers/`
- **THEN** only pages under that directory run, and expectations for other pages are neither checked nor reported stale

#### Scenario: Updating expectations
- **WHEN** a developer runs the command with the update option
- **THEN** the expectations entries for the pages that ran are replaced with their outcomes, existing reasons are kept for entries whose outcome is unchanged, entries for pages that now pass are removed, on a run of whole suites entries for pages those suites no longer contain are removed, and new or changed entries take the page's first failure message (or `timed out` / `crashed`) as their reason, reduced to its first line and at most 200 characters; the command then exits zero unless the expectations file could not be parsed

### Requirement: Backend follows the environment
The runner SHALL create contexts with the backend selected by `OXGL_BACKEND` (backend-selection), and the report SHALL record that requested backend (`auto` when unset). Under `auto` the report does not say which backend served each context; runs meant to be compared set `OXGL_BACKEND` explicitly.

#### Scenario: Software run
- **WHEN** the command runs with `OXGL_BACKEND=software`
- **THEN** every context the pages create renders with SwiftShader and the report records `software`
