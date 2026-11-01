# Tasks

## 1. Reasons in the reports

- [x] 1.1 In `conformance/run.mjs`, give every page entry, the skipped ones included, a `reason`: the reason of the expectations entry that applies to it on the run's platform, or `null` (design D2). In `test/conformance-harness.test.mjs`, verify:
  - An entry with an applicable expectation records its reason.
  - A platform-limited entry records a reason only on its platforms.
  - A page with no entry records `null`.

  Verify that `npm test` passes.
- [x] 1.2 Do the same for example entries in `threejs/run.mjs`, the skipped ones included, with matching cases in `test/threejs-harness.test.mjs`. Verify that `npm test` passes.

## 2. The page builder

- [x] 2.1 Add the template `scripts/results-page.html` (design D3, D4):
  - the opening text explaining oxgl and the page, with links to the repository and both expectations files;
  - the styles, the radio-button toggle and its CSS, the hidden search box, and the inline script for `?all=1` and search;
  - the footer;
  - the two marker comments.

  Add `scripts/results-page.mjs --commit <sha> <dir> <out.html>`:
  - It finds the reports under `<dir>` and takes each one's platform from the report.
  - It names the given commit, and the newest report's timestamp, in the meta line.
  - It names each section's platforms with no report, and writes a note instead of a table for a section with no report at all.
  - It refuses unknown platforms and duplicate reports.
  - It derives each cell's label and hover text, renders the meta line and the sections as escaped static HTML, and writes the filled template.
- [x] 2.2 Add `test/results-page.test.mjs` with small fixture reports. Check the built HTML for:
  - Labels: `PASS`, `FAIL`, `TIMEOUT`, `CRASH`, `SKIP`, `ERROR` and "not run".
  - Hover text: the reason for an expected outcome; the message, then the error, for an unexpected one; "not run" for a missing report; text capped at 1,000 characters.
  - Unexpected cells: an unexpected FAIL and an unexpected PASS are marked, with hover text starting "Unexpected (expected …)"; an example expected as `DIFF 1%` that passes isn't marked; the section counts them.
  - Row classes: `passing` on rows whose only non-PASS cells are "not run", and `all-passing` on a section without failures.
  - Missing reports: a missing macos-arm64 webgl2 report is named in the webgl2 section. A section with no reports says so, has no table, and isn't `all-passing`.
  - Meta: the `--commit` value is shown and linked, and the newest timestamp is used.
  - Rows: the union of rows across platforms, and the counts.
  - Errors: an unknown platform and a duplicate report each fail, naming the file.
  - Escaping: a message containing `</script><b>x</b>` shows as text.
  - The template: no marker is left unreplaced.

  Verify that `npm test` and `npm run lint:js` pass.
- [x] 2.3 Build the page from real reports: `gh run download` the latest `main` run's `conformance-results-*` and `threejs-results` artifacts, then run the builder. Open the result in the browser pane and verify:
  - All three sections render, and the default view lists only rows with a non-PASS cell. The same holds with the page's script removed, and "All rows" still works then.
  - "All rows" shows every row and sets `?all=1`, and reloading that URL keeps it.
  - Searching `texture` narrows every section, and searching `deqp` shows 'No rows in this view match the search' in the webgl1 and three.js sections.
  - Hovering shows expectation reasons, failure messages and "not run", and unexpected cells are marked.
  - The page makes no network requests (network panel).

  Record the file's size here. *(Done 2026-11-01 on run 41349671748 (`10747a4`), which then had webgl1 and three.js reports only. Its webgl2 reports were still running, and the page named them as missing. Reasons were added to those older reports from the expectations files, since they predate task 1.1.
  - Default view: 3 of 971 webgl1 rows and 82 of 377 three.js rows. "All rows" shows 1,348 and sets `?all=1`, and reloading keeps it.
  - Search: `texture` narrows webgl1 to 201 rows and three.js to 26.
  - With the script removed, the default view shows 85 rows, "All rows" shows 1,348, and there's no search box.
  - No network requests beyond the page.
  - Size: 464 KB; with the previous run's webgl2 reports added (11 reports), 1.42 MB, 41 KB gzipped.)*

## 3. CI

- [ ] 3.1 Add the `results` and `pages` jobs to `.github/workflows/ci.yml` as design D5 specifies, with `actions/upload-pages-artifact` and `actions/deploy-pages` pinned to the commit SHAs of their latest releases. Update `CONTRIBUTING.md`'s job table, and add the local build steps (design D6). Verify:
  - actionlint and zizmor pass.
  - A pull request run uploads a `results-page` artifact whose page opens and shows that run's results.
  - The `pages` job is skipped on the pull request.
  - A pull request that changes only a skip-listed file builds no page.

  *(Implemented 2026-11-01, not yet run in CI.)*
  - *Pins: `actions/upload-pages-artifact` v5.0.0 and `actions/deploy-pages` v5.0.1, both by commit SHA.*
  - *Linters: actionlint and zizmor pass.*
  - *Download pattern: checked against `download-artifact` v8.0.2's source. It filters with `Minimatch`, and `{conformance-results-*,threejs-results}` matches exactly the report artifacts. A pattern with no match downloads nothing, without failing.*
  - *Local build: the documented steps build the page from run 41349671748.*
  - *Still to verify: the pull request run, and the skip-only pull request.*
- [ ] 3.2 Add page-only runs (design D7):
  - The `changes` job's `page` output, with `heavy=false` for page-only changes.
  - `npm ci`, ESLint on the page files and `node --test test/results-page.test.mjs` in `repo-checks`.
  - In the `results` job: finding the latest completed `main` run (push or manual, from this repository) with unexpired reports, downloading them with `run-id`, and passing `--commit` and `--page-commit` to the builder.
  - The builder's `--page-commit` option and its meta line, with a test. *(Done 2026-11-01, ahead of the CI parts, which are on hold: `buildPage` takes `pageCommit` and names it only when it differs from `commit`, tested in `test/results-page.test.mjs`.)*

  Verify:
  - The `changes` matching loop, run on sample file lists, reports page-only for a template-only change and a template-plus-README change, and not for a change that also touches `conformance/run.mjs`.
  - A page-only pull request run skips the build and test jobs, passes `ci`, and uploads a preview page naming the earlier `main` commit and its own.
  - With the run lookup pointed at a repository or branch with no reports, the job logs a notice and builds nothing.
  - actionlint and zizmor pass.

  *(Implemented 2026-11-01, not yet run in CI.)*
  - *Classification: the `changes` matching block, extracted from `ci.yml` and run on sample lists, reports page-only for template only, template plus README, and builder plus its test. It reports a full run for builder plus `conformance/run.mjs` and for another script, and neither for README only.*
  - *Run lookup: it accepts only completed push or manual runs of this repository's own `main`. Run against `jerryryle/oxgl`, it skips the in-progress run 41349671748 and finds 41328696463 (`6a96d4e`). Against a repository with no reports, it reports found=false.*
  - *Template script: a builder test compiles the template's inline script.*
  - *repo-checks: its builder lint and test commands pass locally.*
  - *Still to verify: the page-only pull request run in CI.*

## 4. README

- [ ] 4.1 Link the published page (`https://jerryryle.github.io/oxgl/`) from the README's conformance description. Verify that the link renders on the pull request's README preview.

## 5. Rollout (needs the maintainer)

- [ ] 5.1 The maintainer enables Pages: Settings → Pages → Source: GitHub Actions. After the merge, verify that the `main` run's `pages` job deploys, and that the README link opens the page for that commit.

## Workflow follow-up

- Archive this change after 5.1 passes, and verify `npx openspec validate --specs --strict` afterwards.
- `npm-release` also edits `.github/workflows/ci.yml` and `CONTRIBUTING.md`. Whichever change lands second rebases onto the other, and keeps both changes' jobs in `ci.yml`.
- Archive `npm-release` before this change: this change's continuous-integration delta modifies "Triggers" as `npm-release` leaves it, including its `assets/` scenarios.
