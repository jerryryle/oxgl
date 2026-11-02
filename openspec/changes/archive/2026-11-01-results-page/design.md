# Design

## Context

- **Conformance.** The `conformance` job in `.github/workflows/ci.yml` runs on five platforms × two suites. Each run uploads `conformance-results-<runner>-<suite>`, holding the `conformance-results.json` that `conformance/run.mjs` writes. That report records `platform` (from `hostPlatform()`, for example `linux-arm64`) and, per suite, a `pages` list. Each page entry has `path`, `expected`, `outcome`, `message` and `error`. Skipped pages appear as `{ path, expected: 'SKIP', outcome: 'SKIP' }`.
- **three.js.** The `threejs` job runs only on `ubuntu-24.04-arm`, with `npm run threejs`. It uploads `threejs-results` (`threejs-results.json` plus images of failing examples). Its `examples` entries have the same shape, keyed by `name`, plus `diffPercent`.
- **Reasons.** Both runners parse their expectations files with `conformance/expectations.mjs` and already hold the entries that apply on the run's platform (`applicable()`). Each entry has a `reason`. Neither report records it today.
- **Size.** About 3,800 conformance pages and a few hundred examples. Almost every cell is PASS.

## Goals / Non-Goals

**Goals:**
- One file a reader can open anywhere, including from a downloaded artifact.
- No reasoning duplicated from the runners: the page shows what the reports say.

**Non-Goals:**
- Making the page a check: it never fails CI for results. The suites' own jobs do that.
- Freshness guarantees beyond "the latest `main` run that ran the suites" (see Risks).

## Decisions

### D1. The three.js section uses the examples suite's existing report
The examples suite already writes JSON per example and has a reason for every expected non-pass. The nine `node:test` cases in `test/threejs.test.mjs` would have needed JUnit output from `npm test` in every `check` leg, a filter to that one file, and a reason convention for skips. The trade-off is coverage: the examples run only on Linux arm64, so the three.js section has one filled column. Running them on more platforms is a separate change.

### D2. The runners write the reason into each entry
In both runners, the code that builds a report entry looks up the expectations entry that applies to that page or example on this platform. It already does this to fill `expected`. Each report entry gains `reason`, the applicable entry's reason, or `null` when no entry applies. Skipped entries get theirs the same way.

The page builder then doesn't re-parse either expectations file, and can't disagree with the run about which platform-limited entry applied. That matters when a file has changed since the run: the page shows what was true for the commit it describes.

### D3. A template in the repo, filled by the builder
The page's fixed parts live in `scripts/results-page.html`, a complete HTML file reviewed like any other source:
- the opening text (what oxgl is and what the page shows);
- the links to the repository and both expectations files;
- the styles, the controls and the small script;
- the footer.

It has two marker comments, `<!-- results:meta -->` and `<!-- results:sections -->`.

`node scripts/results-page.mjs --commit <sha> <dir> <out.html>` reads every `conformance-results.json` and `threejs-results.json` under `<dir>`, recursively, which is where `actions/download-artifact` places them. It replaces the two markers:
- **meta:** the oxgl commit the run tested, linked to the repository; when the results were produced; the conformance suite commit; and the three.js tag. The reports don't record oxgl's commit (the conformance report's `commit` is the suite's, the three.js report's is the release's), so the builder takes it as `--commit`. The time shown is the newest report's `timestamp`.
- **sections:** for each suite:
  - a heading, a line saying what it covers and where it runs, and its test and non-PASS counts;
  - a line naming each platform with no report for that suite, shown in every view, so a failed job is never hidden by the filter;
  - a table with one row per test. A suite with no report from any platform gets a note saying so instead of a table, and is never marked `all-passing`.

The builder writes the rows as static HTML, so the table needs no script to show. Every report string goes through one HTML-escaping function, as text or as a `title` attribute, so no report text can add markup. The output is the template with the markers replaced, written as `index.html` for Pages.

How the builder reads the reports:
- **Platforms come from the reports.** A cell's platform is the report's `platform`, not the artifact's name, so runner names can change freely.
- **Unknown platforms are an error.** A report from a platform outside the five fails the build.
- **Duplicates are an error.** Two reports for the same suite and platform fail the build and name both files.
- **Cell state:**

  | Report entry | Label | Hover |
  |---|---|---|
  | none for this platform | not run | "not run" |
  | `outcome` = `PASS` | `PASS` | none |
  | `outcome` = `expected`, not `PASS` | the outcome (`HARNESS_ERROR` shows as `ERROR`) | `reason` |
  | `outcome` ≠ `expected`, not `PASS` | the outcome (`HARNESS_ERROR` shows as `ERROR`) | `message`, then `error` |

  Hover text is kept to its first 1,000 characters.
- **Unexpected cells.** A cell is unexpected when its outcome differs from the report's `expected`, where `expected` `DIFF <p>%` counts as `PASS`. It gets the class `unexpected`: a "!" before its label and a solid outline in the failure colour, or the pass colour for an unexpected pass. Its hover text starts with "Unexpected (expected <outcome>): ". Each section's line includes its count of unexpected cells. These are the cells that turned CI red.
- **Rows that pass get a class.** A row with no outcome other than `PASS`, and no unexpected `PASS`, gets the class `passing`; "not run" cells don't count against it. A section with no other rows gets `all-passing`.
- **Size.** About 4,000 rows of static HTML, with a `title` only on cells that aren't PASS. That's estimated at well under 2 MB, and task 2.3 records the real size.

### D4. Interaction, mostly without script
- **The toggle** is two radio inputs styled as a segmented control: "Only rows with a non-PASS result" (checked by default) and "All rows". CSS hides `tr.passing` while the first is checked, using `body:has(#show-failing:checked)`. It works with scripts off.
- **The inline script** adds only two things:
  - It checks "All rows" when the URL has `?all=1`, and keeps the URL in step with `history.replaceState`, without filling the back history.
  - It reveals the search box, which is `hidden` in the HTML, and hides rows whose name doesn't contain the search text, without regard to case. A section with no row shown by both the search and the toggle shows its 'No rows in this view match the search' line, and hides its table; this is rechecked when the toggle changes.
- **The default view** hides rows whose only non-PASS cells are "not run". Otherwise every three.js example, which runs only on Linux arm64, would always show.
- **Hover** uses the native `title` attribute.
- **Styling.** Colours come from CSS custom properties, with a `prefers-color-scheme: dark` variant. Failure variants share the FAIL colour, and SKIP and "not run" are muted.
- **Tried in a mockup.** A mockup built this way, with fake data, renders and toggles with scripts stripped. With scripts it keeps `?all=1` and searches.

### D5. CI jobs
- **The `results` job.**
  - **When it runs:** `needs: [changes, conformance, threejs]`, with `if: ${{ !cancelled() && needs.changes.outputs.heavy == 'true' }}`. It runs after the suites even when they fail, and not at all on a skip-list-only change. It's not in `ci`'s `needs`, so a page-builder bug can't block merges. The builder's unit tests in `npm test` guard it instead.
  - **Steps:** checkout (for the template), setup-node, then `actions/download-artifact` with `pattern: conformance-results-*` and `threejs-results`. It doesn't run `npm ci`: the builder uses only Node built-ins. It runs the builder with `--commit "$GITHUB_SHA"` and uploads `results-page`.
  - **On `refs/heads/main` only:** it also runs `actions/upload-pages-artifact` on the directory holding `index.html`.
- **The `pages` job.**
  - **When it runs:** `needs: results`, with `if: github.ref == 'refs/heads/main' && needs.results.result == 'success'`.
  - **Setup:** `environment: github-pages`, permissions `pages: write` and `id-token: write`, and `concurrency: { group: pages, cancel-in-progress: false }`.
  - **Steps:** `actions/deploy-pages`. Both new actions are pinned to commit SHAs, per `.github/zizmor.yml`.
- **What stays the same:** `permissions: contents: read` at the workflow level. Pull request runs build and upload the page, but the `pages` job's condition keeps them from deploying.

### D7. Page-only changes reuse the last full run's reports
- **Classification.** The `changes` job gains a `page` output. It's `true` when every changed file is on the skip list or is a results page file (`scripts/results-page.html`, `scripts/results-page.mjs`, `test/results-page.test.mjs`), and at least one page file changed. Such a change also sets `heavy=false`, so the build and test jobs skip and `ci` accepts the skips, as for a documentation-only change. A change that touches anything else, such as the runners, is not page-only.
- **Checking the builder.** `repo-checks` runs `npm ci`, ESLint on the three page files, and `node --test test/results-page.test.mjs` on every change. These need no native build, and they make the builder's checks part of the required `ci` check for page-only changes. On a full run they repeat what `check` covers, at a cost of seconds.
- **Finding the reports.** The `results` job runs when `heavy` or `page` is true, with `actions: read`. On a full run it downloads this run's artifacts, as before.
  - **On a page-only run:** a step lists recent completed `ci.yml` runs on `main` through the runs API, newest first. It keeps only push and manual runs whose head repository is this one, so a fork's pull request from a branch named `main` never counts, and an unfinished run's partial reports are never used. It takes the first one with an unexpired `conformance-results-*` artifact (`gh api …/actions/runs/<id>/artifacts`), and records its id and head commit. `actions/download-artifact` then fetches that run's `conformance-results-*` and `threejs-results` with `run-id` and `github-token`.
  - **No such run:** artifacts last 90 days, the repository maximum. If no `main` run in that window uploaded reports, the job writes a notice and builds nothing, and `pages` doesn't run.
- **Labelling.** The builder takes `--commit`, the results' commit (that run's head), and `--page-commit` (`$GITHUB_SHA`). It names the second only when it differs.
- **Deploying.** Unchanged: the `pages` job deploys whatever `results` built, on `main` only.

### D6. Building the page locally
`CONTRIBUTING.md` documents three steps:
1. Download a run's artifacts with `gh run download <run-id> -p 'conformance-results-*' -p threejs-results -D results`.
2. Run `node scripts/results-page.mjs --commit "$(gh run view <run-id> --json headSha -q .headSha)" results results.html`.
3. Open the file.

## Safety rules

No Rust or native code changes, so the unsafe, panic, handle and ArrayBuffer rules are untouched. The builder treats report text as untrusted page content: it escapes it when embedding (D3), and inserts it as text.

## Risks / Trade-offs

- **[Two `main` runs finish out of order, so an older run's page is deployed after a newer one]** → Accepted. The page shows the older results until the next deploy, and the header names its commit.
- **[A push that only changes skip-listed files doesn't rebuild the page]** → Intended: the page keeps describing the last run that ran the suites, whose commit it names. A change to the page's own files rebuilds it from that run's reports (D7).
- **[A page-only push finds no reports younger than 90 days]** → Accepted: the published page stays as it was, and the job log says why. Any full run on `main` brings it back.
- **[The examples suite fills one column]** → Accepted (D1). "not run" says so in every other cell.
- **[A long message makes a native tooltip unwieldy]** → Hover text is capped at 1,000 characters. The full text stays in the run's artifacts.

## Migration Plan

1. The maintainer sets Settings → Pages → Source: GitHub Actions. That also creates the `github-pages` environment, which deploys from the default branch.
2. Merge the change. The first `main` run that runs the suites deploys the page, and the README link works from then on.

Rollback: remove the `pages` job, or switch Pages off. The `results` artifact keeps working without it.
