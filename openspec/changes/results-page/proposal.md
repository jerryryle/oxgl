# Proposal

## Why

CI runs both Khronos WebGL conformance suites on five platforms and three.js's own examples on Linux arm64, but the results live in per-job artifacts. Seeing how one page or example fares across platforms, or why it fails, means downloading and reading several JSON files. A single published table makes oxgl's standing visible to users and maintainers at a glance.

## What Changes

- **One results page, published to GitHub Pages from `main`.**
  - It has a row per test and a column per platform, in a fixed order: linux-x64, linux-arm64, macos-arm64, windows-x64, windows-arm64.
  - It's grouped into three sections: webgl1, webgl2, and the three.js examples.
  - Each cell shows PASS, FAIL or SKIP. TIMEOUT, CRASH and a harness error are failure variants with their own labels, and a platform with no result shows "not run".
- **Hovering over a cell that isn't PASS shows why:**
  - For an outcome the expectations predicted: the expectation's reason.
  - For an unexpected outcome: the runner's message or error.
  - For a missing result: "not run".
- **Unexpected results stand out.** A cell whose outcome differs from what its platform expected carries a "!" and an outline, and its hover text says what was expected. Each section counts them. These are the results that turn CI red, so a reader sees a regression among known failures at a glance, and an unexpected pass isn't hidden as PASS.
- **Filtering.** A search box filters rows by name. A clearly visible toggle switches between "Only rows with a non-PASS result" (the default) and "All rows", across every section. The toggle's state is kept in the URL (`?all=1`), so a link opens the same view.
- **Reasons come from the runners.** The conformance and three.js runners record each applicable expectation's reason in their report entries, so the page builder doesn't re-parse either expectations file.
- **A template, filled in CI.** Most of the page lives in the repo as `scripts/results-page.html`: an explanation of what oxgl is and what the page shows, links to the repository and the expectations files, the styles, and the controls. `scripts/results-page.mjs` fills its two markers from the ten conformance reports and the three.js report, rendering the rows as static HTML. The output is one self-contained file.
- **Works without JavaScript.** The table and the toggle work with scripts off, using radio buttons and CSS. A small inline script adds the `?all=1` URL state and the search box.
- **CI.**
  - A `results` job builds the page after the `conformance` and `threejs` jobs, even when they fail, and uploads it as an artifact.
  - On `main` only, a `pages` job deploys it with `actions/upload-pages-artifact` and `actions/deploy-pages`. The `pages: write` and `id-token: write` permissions are scoped to that job.
  - Pull request runs never deploy.
- **README** links the published page.

Changed from the original brief, by decision: the three.js section uses the three.js examples suite (`npm run threejs`, the `threejs` job), not the nine `node:test` cases in `test/threejs.test.mjs`. That suite already writes a JSON report and gives a reason for every expected failure, so no JUnit output from `npm test` is needed. It runs only on Linux arm64, so its other columns show "not run".

Out of scope:
- Running the three.js examples on platforms other than Linux arm64.
- The `node:test` suites, including `test/threejs.test.mjs`, and JUnit output.
- History across runs, trends, or comparisons between commits: the page shows one run's results.
- Keeping the search text in the URL.
- Images of failing three.js examples on the page; they stay in the `threejs-results` artifact.

Extension points left for later:
- A new suite is a new section fed by another report with the same entry shape (name, expected, outcome, reason, message, error, platform).
- If the examples suite moves to more platforms, its other columns fill in with no change to the page.

## Capabilities

### New Capabilities
- `results-page`: the published table of conformance and three.js example results. It covers what the page shows per test and platform, where hover reasons come from, the filter and search behaviour, the page explaining itself, and the page being a single self-contained file that works without JavaScript.

### Modified Capabilities
- `conformance-testing`: the results report records the reason of the expectation that applied to each page.
- `threejs-examples`: the results report records the reason of the expectation that applied to each example.
- `continuous-integration`: adds the `results` job, which builds the page on every run that runs the suites, and the `pages` job, which deploys it from `main` only.

## Impact

- `conformance/run.mjs` and `threejs/run.mjs`: a `reason` field on report entries.
- New `scripts/results-page.html` (the template), `scripts/results-page.mjs` (the builder), and `test/results-page.test.mjs` with fixture reports.
- `.github/workflows/ci.yml`: the new `results` and `pages` jobs, and two new actions pinned by commit SHA.
- `README.md` (the link) and `CONTRIBUTING.md` (job table, and how to build the page locally).
- The maintainer enables GitHub Pages: Settings → Pages → Source: GitHub Actions.
- `.github/workflows/ci.yml` also changes on the open `npm-release` branch, so whichever lands second rebases onto the other.
