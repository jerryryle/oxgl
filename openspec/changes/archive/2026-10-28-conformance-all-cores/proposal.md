# Proposal

## Why

A full conformance run is the slowest check in CI: on commit 90e95e9 (CI run 40812499245, `ubuntu-24.04-arm`, 4 CPUs) `webgl1` took 757 s and `webgl2` 1,841 s. The runner defaults to half the CPUs, 2 pages at a time, because the `conformance-harness` design expected SwiftShader's per-context thread pools to oversubscribe the CPU and make heavy pages flip between `PASS` and `TIMEOUT`. A measurement run of the same commit with `--jobs 4` (run 40812778860, draft PR #24, closed) does not show that:

| | `--jobs 2` | `--jobs 4` |
|---|---|---|
| `webgl1` wall time | 757 s | 418 s |
| `webgl2` wall time | 1,841 s | 1,048 s |
| Outcomes that differ | — | 0 of 3,836 |
| Longest gap between results in a passing page (`maxGapMs`) | 896 ms | 1,119 ms |
| Median page duration | 751–768 ms | 937–965 ms |

Pages run about 25% slower each, but the longest gap stays about 1 s against the 20 s limit, and the pages that time out wait the same 20 s either way, so more of them overlap.

## What Changes

- `npm run conformance` runs as many pages at once as there are CPUs available to the process (`os.availableParallelism()`), instead of half of them. `--jobs` still overrides it.
- A new `Pages run in parallel` requirement names the parallelism option and its default, so the default cannot drift back silently.
- `CONTRIBUTING.md` states the new default.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `conformance-testing`: gains the "Pages run in parallel" requirement, naming the parallelism option and its default, with a scenario for the default.

## Impact

- `conformance/pool.mjs` (`defaultJobs`), `CONTRIBUTING.md`. No library code, CI workflow or expectations change.
- CI: both conformance jobs about 1.8× faster on the 4-CPU runner.
- Developer machines with more CPUs run more pages at once too; `--jobs` lowers it when that machine is otherwise busy.

## Out of Scope and Extension Points

- The time limit and `TIMEOUT` pages, now the largest remaining cost (78 `webgl2` pages × 20 s). They can be addressed separately, for example by moving confirmed hangs to `SKIP`.
- Running several pages per child process to avoid per-page process startup (about 0.7 s per page). It weakens page isolation and needs its own design.
