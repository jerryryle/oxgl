# Design

## Context

See proposal.md for the measurements. The `conformance-harness` design chose `max(1, floor(os.availableParallelism() / 2))` workers because SwiftShader sizes a thread pool per context to the machine, and expected one page per CPU to slow heavy pages enough to cross the 20 s inactivity limit. It also set the check for that risk: the passing page with the longest gap between results (`maxGapMs`) must stay under half the limit at the default pool size.

## Goals / Non-Goals

**Goals:** shorter conformance runs with outcomes that do not depend on the pool size on the CI runner.

**Non-Goals:** changing the time limit, the `TIMEOUT` pages, or how pages are isolated.

## Decisions

- **Default to `max(1, os.availableParallelism())`.** On the 4-CPU CI runner, 4 pages at once gave identical outcomes on all 3,836 pages and a longest passing gap of 1,119 ms, under a tenth of the 20 s limit, against the half-limit check the harness design set. Most of a page's time is process startup and jsdom parsing, which is single-threaded, so the extra SwiftShader threads rarely compete.
  - *Rejected: more pages than CPUs.* Pages are CPU-bound during startup, so oversubscribing would slow every page without shortening the run much, and it moves gaps toward the limit.
  - *Rejected: setting `--jobs 4` only in CI.* It would leave local runs at half speed and the default argued from a risk the measurement did not find.
- **The default goes into the spec.** The number of pages run at once affects which pages can time out, which is why the report already records it. Naming the default in its own requirement ("Pages run in parallel") makes a future change to it a spec change.

Safety rules: JS-only change to the test runner; no `unsafe`, handles or ArrayBuffer lifetimes are touched.

## Risks / Trade-offs

- [A heavy page that later reports nothing for a long stretch becomes more likely to time out under contention] → each expectations regeneration (`--update`) records `maxGapMs`; if a passing page comes within half the limit, lower the default or the page's load, as the harness design already requires.
- [Machines with many CPUs run many SwiftShader contexts at once] → only measured on the 4-CPU runner. `--jobs` overrides it, and CI, which gates merges, runs on the measured runner.
