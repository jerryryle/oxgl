# Proposal

## Why

The Node test for "Dropped contexts are reclaimed" fails intermittently in CI. In CI run 40645729850 it failed on `node-range (26)` with `RSS grew by 42.0 MiB (limit 32 MiB)`. The same commit passed on every other job. Across recent CI runs the measured growth on the GC path was 0 MiB in most jobs and jumped to 15–48 MiB in others (Linux, macOS, Node 22.12.0 and 26 alike), sometimes going negative. Locally, 40 back-to-back passes of 1,000 dropped contexts (macOS, Node 26) showed:

- a flat V8 heap;
- one-off RSS steps of about 20 MiB, after which RSS levelled off at roughly 160 B per context;
- the same curve for contexts released with `destroy()`.

That is allocator high-water noise, not a leak. The scenario measures one pass against one baseline, so it fails whenever a step happens to land in the measured pass. A required `ci` gate that flakes gets ignored, so the test has to be deterministic. It also has to stay a real leak gate.

## What Changes

- The scenario "Dropped contexts are reclaimed" measures three consecutive passes of 1,000 dropped contexts after the warm-up, instead of one. It gates on the **smallest** per-pass RSS growth, which must stay within the soak-test threshold (32 MiB). A leak grows RSS on every pass, while a high-water step is a one-off that shows up in at most one pass, so taking the minimum filters the noise without loosening the limit.
- The scenario also requires the live-context count to return to its baseline after every pass. The test already waits for this, but the scenario does not state it.
- The threshold stays at 32 MiB, and so does the `destroy()` soak scenario.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-creation`: the "Garbage-collected contexts release resources" requirement's scenario "Dropped contexts are reclaimed" changes how growth is measured. The requirement text itself is unchanged.

## Impact

- `test/soak.test.mjs`: the `dropped contexts are reclaimed` test. No library code changes.
- Test runtime: about 0.8 s more (two extra passes).

## Out of Scope and Extension Points

- The `destroy()` soak test ("Software soak test"). It has not flaked: across those CI runs its growth stayed between 1.4 and 6.7 MiB. If it ever does flake, the same minimum-of-passes method applies.
- Exposing the EGL-level context and surface counters (`oxgl_sys::live_contexts`/`live_surfaces`) to Node. The Rust soak tests and the ASan/LSan job already gate native release.
- Finding the cause of the allocator steps (system malloc, glibc arenas, SwiftShader pools). These steps are bounded and not a leak.
