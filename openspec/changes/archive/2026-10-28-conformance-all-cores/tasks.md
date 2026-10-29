# Tasks

## 1. Runner

- [x] 1.1 In `conformance/pool.mjs`, make `defaultJobs()` return `max(1, os.availableParallelism())` and update its comment. Update the `--jobs` default in `CONTRIBUTING.md`'s "Conformance tests" section to "the number of CPUs". Verify that `npm run lint` and `npm test` pass, and that `npm run conformance -- --help` still lists `--jobs`.

## 2. CI verification

- [x] 2.1 In the PR's CI, verify that both `conformance` jobs pass with the reports recording `jobs: 4`, that no page's outcome differs from main's latest run, and that every passing page's `maxGapMs` is under 10 s (half the limit). Record both suites' wall-clock times in this task.
  - Result: verified by the measurement run 40812778860 (draft PR #24, `--jobs 4` at commit 90e95e9) against main's run 40812499245 at the same commit: both jobs passed, 0 of 3,836 outcomes differ, the longest passing `maxGapMs` is 1,119 ms, and `webgl1` took 418 s and `webgl2` 1,048 s.

## Workflow follow-up

- Archive the change after review, merge and a green `ci` on main.
