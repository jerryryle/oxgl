# Spec Delta

## Purpose

Defines the published results page: one table of the Khronos WebGL conformance suites' and the three.js examples' outcomes on every supported platform, with the reason for each result that is not a pass.

## ADDED Requirements

### Requirement: One row per test, one column per platform
The page SHALL have three sections: webgl1, webgl2 (the Khronos WebGL 1.0 and 2.0 conformance suites, conformance-testing) and three.js (the three.js examples, threejs-examples). Each section SHALL have one row per page or example that any platform reported, sorted by name, and columns for linux-x64, linux-arm64, macos-arm64, windows-x64 and windows-arm64 in that order. Each platform's column SHALL come from the `platform` its report records.

#### Scenario: Union of rows
- **WHEN** a webgl2 page appears in the Linux arm64 report but not in the Windows x64 report
- **THEN** the page has one row for it, with Linux arm64's outcome and "not run" under windows-x64

#### Scenario: Three.js columns
- **WHEN** the three.js examples ran only on Linux arm64
- **THEN** every three.js row shows Linux arm64's outcome and "not run" in the other four columns

### Requirement: Cell labels
Each cell SHALL show the outcome its platform's report records: `PASS`, `FAIL` or `SKIP`, or one of the failure variants `TIMEOUT`, `CRASH` and `ERROR` (a harness error), each with its own label. A cell whose platform has no result for that row SHALL show "not run". A FAIL cell SHALL look different from a PASS cell and from a SKIP cell, and a failure variant SHALL look like a failure.

#### Scenario: Timeout label
- **WHEN** a conformance page's outcome on macOS arm64 is `TIMEOUT`
- **THEN** its macos-arm64 cell reads `TIMEOUT` and is styled as a failure

### Requirement: Hover reasons
Hovering over a cell that isn't PASS SHALL show why:
- When the outcome is the one the applicable expectation predicted, the expectation's reason.
- When it isn't, the report's message, then its error.
- For "not run", the words "not run".

The reason SHALL come from the report entry, not from re-reading an expectations file.

#### Scenario: Expected failure
- **WHEN** `conformance/glsl/misc/shader-with-double-underscore.html` is expected to `FAIL` in webgl1 on every platform, with the reason beginning "ANGLE: rejects identifiers containing __", and fails on Linux x64
- **THEN** hovering over its linux-x64 cell shows that whole reason

#### Scenario: Unexpected failure
- **WHEN** a page expected to pass fails on Windows arm64 with the message "expected 1, got 0"
- **THEN** hovering over its windows-arm64 cell shows "expected 1, got 0"

#### Scenario: Skipped example
- **WHEN** a three.js example is listed as `SKIP` with the reason "upstream: video hangs CI"
- **THEN** its linux-arm64 cell reads `SKIP`, and hovering over it shows that reason

### Requirement: Unexpected results are marked
A cell whose outcome differs from the outcome its platform expected SHALL carry a visible mark, beyond its colour, and its hover text SHALL begin by saying it was unexpected and what was expected. An expected `DIFF <p>%` counts as expecting `PASS`. Each section SHALL say how many unexpected results it has.

#### Scenario: Regression among known failures
- **WHEN** a webgl2 page expected to pass fails on Windows x64, in a section with forty expected failures
- **THEN** only that cell is marked, its hover text begins "Unexpected (expected PASS)", and the section says it has 1 unexpected result

#### Scenario: Unexpected pass
- **WHEN** a page expected to `FAIL` on every platform passes on Linux arm64 and fails elsewhere
- **THEN** its linux-arm64 cell reads `PASS` with the mark, and its hover text begins "Unexpected (expected FAIL)"

### Requirement: Missing reports are named
Each section SHALL name every platform that has no report for it, whatever filter is selected, so a missing report never looks like a pass. A section with no report from any platform SHALL say so instead of showing an empty table.

#### Scenario: One platform's job failed
- **WHEN** the macOS arm64 webgl2 job failed before writing its report, and every other platform passed every webgl2 page
- **THEN** the webgl2 section says it has no report from macos-arm64, in the default view as well as with "All rows"

#### Scenario: Three.js examples on one platform
- **WHEN** the three.js report came only from Linux arm64
- **THEN** the three.js section says it has no report from linux-x64, macos-arm64, windows-x64 or windows-arm64

#### Scenario: No report at all
- **WHEN** the `threejs` job failed before uploading its report
- **THEN** the three.js section says no platform reported results, and doesn't claim that every test passed

### Requirement: Filter toggle
The page SHALL have a clearly visible toggle between "Only rows with a non-PASS result" and "All rows" that applies to every section, and SHALL default to the first. A row counts as non-PASS when at least one platform reported an outcome other than `PASS`, or an unexpected `PASS`; "not run" cells don't count. The toggle's state SHALL be kept in the URL query (`all=1` for all rows), so opening that URL shows the same view.

#### Scenario: Default view
- **WHEN** the page is opened without a query
- **THEN** it shows only rows where some platform reported an outcome other than `PASS`, and "Only rows with a non-PASS result" is selected

#### Scenario: Not run doesn't count
- **WHEN** a three.js example passes on Linux arm64 and is "not run" on the other four platforms
- **THEN** its row is hidden in the default view and shown with "All rows"

#### Scenario: Shared link
- **WHEN** a reader selects "All rows" and copies the URL, and someone opens that URL
- **THEN** the URL ends in `?all=1` and the page opens showing all rows

### Requirement: Search box
When scripts run, a search box SHALL show only rows whose name contains its text, without regard to case, in every section, on top of the toggle. A section left with no visible rows, after the search and the toggle, SHALL say that no rows in this view match.

#### Scenario: Search
- **WHEN** a reader types `texture` into the search box with "All rows" selected
- **THEN** each section shows only rows whose name contains `texture`

#### Scenario: No match in a section
- **WHEN** a reader searches for `deqp`, which matches no webgl1 or three.js row
- **THEN** those two sections say that no rows in this view match the search, instead of showing an empty table

### Requirement: Self-contained page
The page SHALL be a single HTML file with its styles and script inline, and SHALL make no network request when opened. Its table and the filter toggle SHALL work without JavaScript; the script SHALL only keep the toggle in the URL and provide the search box, which stays hidden when scripts don't run.

#### Scenario: Opened from disk
- **WHEN** the built page is downloaded from a CI run's artifacts and opened from disk with networking off
- **THEN** it renders every section, and the toggle, search and hover reasons work

#### Scenario: Scripts disabled
- **WHEN** the page is opened in a viewer that doesn't run scripts
- **THEN** every section's rows render, the default view shows only rows with a non-PASS result, choosing "All rows" shows every row, and no search box is shown

#### Scenario: Report text cannot break the page
- **WHEN** a failure message contains `</script>` or HTML tags
- **THEN** the page still renders, and the hover reason shows the text literally

### Requirement: The page explains itself
The page SHALL say what oxgl is and what the page shows, and SHALL link to the oxgl repository, to both expectations files, and to the oxgl commit the CI run tested. It SHALL name when the results were produced (the newest report's timestamp), the conformance suite commit and the pinned three.js release. Each section SHALL say which suite it covers, on which platforms it runs, how many tests it has, and how many have a result that isn't PASS.

#### Scenario: A reader arrives from a link
- **WHEN** someone opens the page without knowing oxgl
- **THEN** its opening text says what oxgl is and what the table shows, and links to `https://github.com/jerryryle/oxgl`

#### Scenario: Results commit
- **WHEN** the page was built from a CI run that tested oxgl commit `b31fde2`
- **THEN** the page names `b31fde2` and links to it in the repository, not the conformance suite's or three.js's commit
