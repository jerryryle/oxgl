# Proposal

## Why

`webgl_loader_gltf_transmission` intermittently fails on CI with 12% of pixels differing (main run 41359256250, job `threejs` on `ubuntu-24.04-arm`) and passes at 0.36% otherwise (PR run 41353514964). The failing frame shows only the background.

A trace on Linux arm64 found the likely cause: the runner's parse allowance has always been 0. `conformance/server.mjs` counts served bytes with `res.getHeader('content-length')`, but it sets that header through `writeHead()`, whose headers Node does not cache for `getHeader()`. So `activity().bytes` stays 0, and the runner releases the frame right after the 1 s idle wait. In the trace, the GLB is requested 75 ms after the HDR arrives and the idle wait returns 1 s after the Draco decoder arrives. A stall of about 2.8 s follows the release. The trace timed it but not its content: it is likely the model's decode and parse, which would make the model reach the frame only when that work finishes before the released frame renders, but it could also be the first render (shader compilation on SwiftShader, say), which no allowance helps. The allowance would have been at least 4.5 s, for the HDR and GLB alone; the three.js build, its addons and the Draco decoder add more. Task 2.1's repeated runs settle whether the allowance removes the failure. The bug dates from the runner's introduction in #32.

## What Changes

- **The server counts the bytes it serves.** It adds each successful response's file size, which it already has from `stat`, instead of reading the header back.
- **A test covers the allowance itself.** A fixture page draws a while after its load arrives, within that load's allowance, so a runner that skips the allowance fails it. The existing "Large assets" test passed only because there was nothing to cap.
- **Expectations are rechecked.** With the allowance working, an entry that was a symptom of capturing too early (a `FAIL` or `DIFF` whose frame lacks late-loaded content) can now pass, and the suite's run time grows by each example's allowance. Candidates are reported to the user, not changed silently.

### Out of scope

- Loads chained so that a request starts after the 1 s idle wait has ended are still missed. The trace showed no such chain here (the GLB request starts 75 ms after the HDR arrives), and none is known in the suite. This change adds no machinery for it.
- The Khronos conformance runner shares the server but does not read `bytes`, so it is unaffected.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `threejs-examples`: the deterministic frame gains a scenario that the parse allowance follows the bytes actually served. The requirement's text is unchanged; the runner did not meet it.

## Impact

- `conformance/server.mjs` (byte counting); a fixture page and a test in `test/threejs-harness.test.mjs`.
- `threejs/expectations.txt`, only if the user approves changes to candidates found.
- Suite run time: each example now waits 1 s per MB it is served, at most 30 s, as upstream's test does.
- oxgl itself does not change.
