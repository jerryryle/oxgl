# conformance-testing Specification

## Purpose
Measures oxgl against the Khronos WebGL 1 and WebGL 2 conformance suites under Node, and holds every change to a checked-in record of which conformance pages are expected to pass.

## Requirements

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

### Requirement: oxgl objects belong to the page
As in a browser, oxgl's context classes, the contexts a page creates and the errors oxgl's API throws SHALL belong to the page's own JavaScript realm.

#### Scenario: Errors are the page's own types
- **WHEN** a page calls a context method with an argument WebIDL rejects and checks the exception with `instanceof TypeError` (as `wtu.shouldThrow` does)
- **THEN** the check succeeds, and the classes' prototype chains end at the page's own `Object.prototype` (cf. Khronos `conformance/context/context-type-test.html`)

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

### Requirement: Closure-loaded scripts run in browser order
When a page loads scripts through the Closure Library's uncompiled loader (`goog.require` in `closure-library/closure/goog/base.js`, as every `deqp/` page does), each file the loader imports SHALL run before the import returns, dependencies first, as a script written with `document.write` during parsing runs in a browser (HTML Standard §8.4.3).

#### Scenario: deqp namespace defined before the page uses it
- **WHEN** a page calls `goog.require('functional.gles3.es3fAttribLocationTests')` from a `<head>` script and calls that namespace's `run` from a later `<body>` script (Khronos `deqp/functional/gles3/attriblocation.html`)
- **THEN** the `<body>` script finds the namespace defined and the page goes on to create its context, instead of throwing `ReferenceError: functional is not defined`

### Requirement: Closure-loaded scripts fail on their own
An uncaught error in a file the Closure loader imports SHALL be recorded as the page's escaped error (Escaped script errors) and SHALL NOT stop the remaining imports. A file the loader names that is missing, outside the suite root or on another origin SHALL NOT be run.

#### Scenario: Error in an imported file
- **WHEN** one file the loader imports throws at its top level and the page expects to pass
- **THEN** that error is recorded as the page's escaped error with the imported file named in it, the files imported after it still run, and the page is judged as any page with an escaped error is

#### Scenario: Imported file missing
- **WHEN** the dependency table names a file that does not exist under the suite root, or one on another origin
- **THEN** the file is not run, the namespaces it would provide stay undefined, and the page fails from its own scripts rather than with a harness error

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

### Requirement: Escaped script errors
A page SHALL end early on errors when its expectation is `FAIL` or when the run asks for every page to end early on errors: it ends at the first escaped script error. Every other page SHALL treat an escaped script error as the official harness (`webgl-test-harness.js`) does: the error is recorded and the page keeps running until it completes or reaches the time limit. The first escaped error's message SHALL be recorded for every page that has one.

#### Scenario: Empty expectations
- **WHEN** the expectations file has no entries and the run does not ask for every page to end early on errors
- **THEN** every page is judged as the official harness judges it

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
The root `package.json` SHALL expose `npm run conformance`, which runs both suites against the built package and exits non-zero when the run fails. It SHALL accept options to select one suite, to restrict the run to pages whose path contains a given substring, to include `SKIP` pages, to make every page end early on errors (Page outcome), and to rewrite the expectations file from the run's outcomes. A filtered run SHALL judge only the pages it ran.

#### Scenario: Filtered run
- **WHEN** a developer runs the command restricted to `conformance/buffers/`
- **THEN** only pages under that directory run, and expectations for other pages are neither checked nor reported stale

#### Scenario: Updating expectations
- **WHEN** a developer runs the command with the update option
- **THEN** the run is judged against the expectations it writes, the expectations entries for the pages that ran are replaced with their outcomes, existing reasons are kept for entries whose outcome is unchanged, entries for pages that now pass are removed, on a run of whole suites entries for pages those suites no longer contain are removed, and new or changed entries take the page's first escaped error as their reason, or its first failure message when it has none (for `TIMEOUT` and `CRASH`, `no new result within the time limit` / `crashed`, followed by the first escaped error's message when there is one), reduced to its first line and at most 200 characters; the command then exits zero unless the expectations file could not be parsed or a page had a harness error

### Requirement: Pages run in parallel
The conformance command SHALL accept an option setting how many pages run at once, defaulting to the number of CPUs available to the process (at least one).

#### Scenario: Default parallelism
- **WHEN** a developer runs the command without the parallelism option on a machine where 4 CPUs are available to the process
- **THEN** up to 4 pages run at once, and the report records 4 as the number of pages run in parallel

### Requirement: Backend follows the environment
The runner SHALL create contexts with the backend selected by `OXGL_BACKEND` (backend-selection), and the report SHALL record that requested backend (`auto` when unset). Under `auto` the report does not say which backend served each context; runs meant to be compared set `OXGL_BACKEND` explicitly.

#### Scenario: Software run
- **WHEN** the command runs with `OXGL_BACKEND=software`
- **THEN** every context the pages create renders with SwiftShader and the report records `software`
