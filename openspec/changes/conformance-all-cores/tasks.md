# Tasks

## 1. Runner

- [ ] 1.1 In `conformance/pool.mjs`, make `defaultJobs()` return `max(1, os.availableParallelism())` and update its comment. Update the `--jobs` default in `CONTRIBUTING.md`'s "Conformance tests" section to "the number of CPUs". Verify that `npm run lint` and `npm test` pass, and that `npm run conformance -- --help` still lists `--jobs`.

## 2. CI verification

- [ ] 2.1 In the PR's CI, verify that both `conformance` jobs pass with the reports recording `jobs: 4`, that no page's outcome differs from main's latest run, and that every passing page's `maxGapMs` is under 10 s (half the limit). Record both suites' wall-clock times in this task.

## Workflow follow-up

- Archive the change after review, merge and a green `ci` on main.
