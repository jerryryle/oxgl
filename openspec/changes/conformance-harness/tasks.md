# Tasks

## 1. Suite pin and fetch

- [x] 1.1 Pick the current `KhronosGroup/WebGL` commit, record it and the 1.0.x / 2.0.x list versions its harness uses in `conformance/suite.json`, and gitignore `.cache/` and `conformance-results.json`. Verify by running `git check-ignore` on both paths.
- [x] 1.2 Implement the sparse, blobless, depth-1 fetch of `sdk/tests` at the pinned SHA into `.cache/conformance/<sha>/`, reused when present. Verify that a clean fetch yields `sdk/tests/00_test_list.txt` and that a second run does not touch the network.
- [x] 1.3 Add `jsdom` as a pinned devDependency (edit `package.json` in place and keep `@fission-ai/openspec`). Verify with `npm ci` and `npm run lint:licenses`, which must stay green because jsdom does not ship.

## 2. Test lists and expectations

- [x] 2.1 Implement the test-list parser: nested `00_test_list.txt`, comments, and `--min-version`/`--max-version`, producing the page list per suite. Unit-test it in `test/conformance-harness.test.mjs` against fixture lists, covering nesting and version filtering, including `conformance2/` only in `webgl2`.
- [x] 2.2 Implement the expectations parser and writer: the line format, sorted output, and rejection of missing reasons, unknown outcomes and duplicates, plus normalization of generated reasons to one line of at most 200 characters. Unit-test parsing errors, round-trip stability, and a multi-line failure message turned into a single-line reason.
- [x] 2.3 Implement judging: regressions, unexpected passes, outcome mismatches, stale entries (only on unfiltered runs, and only for the suites that ran), included `SKIP` pages reported but not judged, and `--update` that keeps reasons for unchanged outcomes, leaves `SKIP` entries alone, drops stale entries on unfiltered runs, and uses the normalized first failure message otherwise. Unit-test each case in the spec's "Checked-in expectations", "Runs are judged against expectations" and "Conformance command" scenarios, including a single-suite run, `--include-skipped`, an `--update` run that removes a stale entry, and an `--update` run with differences that exits zero.

## 3. Page runner

- [x] 3.1 Implement the loopback static server over the suite root (127.0.0.1, ephemeral port, no paths outside the root). Unit-test that a `..` path is refused.
- [x] 3.2 Read how `webgl-test-harness.js` at the pinned commit judges a page that finishes with no results and one with an uncaught error. If either differs from the spec's "Page outcome" rule, update the spec to match before continuing. Then implement the page child: jsdom window, `getContext` shim, context class globals, `webglTestHarness` hooks, media elements that fail promptly, `getContext` returning `null` with the message recorded when `createContext` throws, `onerror` capture that ends the page early only when it ends early on errors (its expectation is `FAIL`, or `--fast-errors`) and otherwise records the error and keeps running, and context `destroy()` at page end, reporting the outcome over IPC. Verify with fixture pages under `test/fixtures/conformance/`. Each page must reach its expected outcome: passes, one with a failing result, one with no results, an uncaught `TypeError` run as expected-`FAIL` (`FAIL` well before the time limit), an uncaught error in a page that never completes, run as expected-`FAIL` (`FAIL` well before the time limit) and as expected-`PASS` (`TIMEOUT`, with the error recorded), an uncaught error from a callback in a page that then completes with only passing results, run as expected-`PASS` (`PASS`), one that waits on an image (`FAIL` well before the time limit), one that checks `getContext('2d') === null` and the 300×150 default size, and one that gets `null` from `getContext('webgl')` on a 0×0 canvas.
- [x] 3.3 Implement the parent pool: `--jobs` defaulting to half of `os.availableParallelism()` (at least 1), per-page inactivity timeout (the official harness's 20 s watchdog, restarted by each result) with kill, each page's expected outcome and `--fast-errors` passed to its child, `CRASH` on abnormal exit, and `webglVersion=2` on URLs in the `webgl2` suite. Verify with fixture pages that wait on a never-settling promise (`TIMEOUT`) and call `process.abort()` (`CRASH`), plus one that reports all-pass and then aborts during teardown (`CRASH`). Confirm that the hung page is `TIMEOUT`, not `CRASH`, and that a page the child cannot set up (a missing page path) fails the run as a harness error without an outcome or expectation entry, while the other fixtures still run and the report is written, and check that the other fixtures in the same run are unaffected.
- [x] 3.4 Implement the results report: per-page outcome, counts, duration and first message, plus commit, requested backend (`OXGL_BACKEND` value, or `auto`), time limit, `--jobs` value, platform and timestamp. Verify that the fixture run's report contains each field and is written when the run fails.

## 4. Command and documentation

- [x] 4.1 Add `npm run conformance` with `--suite`, `--filter`, `--include-skipped`, `--fast-errors`, `--update`, `--timeout` and `--jobs`, failing clearly when `dist/` is not built. Verify that a filtered real run (`--filter conformance/context/`) completes and exits according to the expectations.
- [x] 4.2 Document running, filtering and updating expectations in `CONTRIBUTING.md`, and mention the harness in `README.md`. Verify by running the documented commands as written.
- [x] 4.3 Run `npm run lint` and `npm test` (with `OXGL_BACKEND=software`), and confirm both pass with the harness's own tests included.

## 5. Initial expectations

- [x] 5.1 Run both full suites on Linux arm64 with `OXGL_BACKEND=software`, `--update` and `--fast-errors` (the file is still empty, so without it every page that throws would wait out the time limit) to generate `conformance/expectations.txt`. Record each suite's wall-clock time and the passing page with the longest gap between results (the report's `maxGapMs`) in this task. Verify that this gap is less than half the time limit at the default `--jobs`, and raise the limit or lower the default if it is not.
  - Result (CI run 40755917940, `ubuntu-24.04-arm`, default `--jobs` 2): webgl1 971 pages in 447 s, webgl2 2,865 pages in 1,139 s. 7 pages pass in each suite. The passing page with the longest gap between results is `conformance/typedarrays/typed-arrays-in-workers.html` in webgl2 at 722 ms, almost all of it process startup, well under half the 20 s limit. No crashes and no harness errors.
- [ ] 5.2 Review the generated entries. Convert confirmed hangs to `SKIP` with a reason, make sure every `CRASH` entry names the follow-up that fixes it, and check that the pages oxgl already supports (for example `conformance/rendering/gl-clear.html`, if it reaches only implemented calls) pass. Verify that a plain `npm run conformance` then succeeds twice in a row with identical outcomes.

## 6. CI

- [x] 6.1 Add the `conformance` job to `.github/workflows/ci.yml`: an `ubuntu-24.04-arm` matrix over `suite`, the build steps from `check`, a suite cache keyed by `hashFiles('conformance/suite.json')`, `OXGL_BACKEND=software`, and `actions/upload-artifact` pinned by SHA with `if: always()` and the artifact named `conformance-results-${{ matrix.suite }}`. Add it to `ci`'s `needs`. Verify that actionlint and zizmor pass in `workflow-lint`.
- [ ] 6.2 Verify in a pull request's CI run that both matrix entries pass, both suites' report artifacts are downloadable, and a deliberately broken expectation (removing one `FAIL` entry on a scratch commit) fails `ci` with the page named.

## Workflow follow-up

- Archive the change after review and a green `ci` on `main`.
