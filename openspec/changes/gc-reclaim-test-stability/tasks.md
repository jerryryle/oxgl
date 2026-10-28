# Tasks

## 1. Test

- [ ] 1.1 In `test/soak.test.mjs`, add a helper that takes a pass function and a pass count, measures RSS after a forced GC before the first pass and after each one, and returns the per-pass growths. Make each `dropContexts` pass end with a wait (failing after 10 s) until `liveContexts()` is back at its baseline, independent of the pass size. Change `dropped contexts are reclaimed` to use the helper: keep the existing two-pass warm-up in the test, then run three measured passes. After every pass, assert that `liveContexts()` equals the pre-test value. Assert that the median growth is at most 32 MiB, and report all three growths in a diagnostic. Verify that `OXGL_BACKEND=software npm test` passes locally and that `npm run lint:js` is clean.
- [ ] 1.2 Check that the RSS gate still catches a leak. Temporarily make `oxgl-node`'s finalizer path leak a touched 64 KiB allocation per collected context (`Box::leak`, with the contexts themselves still released, so `liveContexts()` stays correct). Rebuild, and confirm that the test fails on the RSS assertion (median growth of about 64 MiB) and not on the counter. Then revert the change and confirm that `git diff crates/` is empty.

## 2. CI verification

- [ ] 2.1 Re-run the PR's CI at least three times. Verify that `check` (Linux, macOS, Windows) and `node-range` (22.12.0, 26) pass every time, and record all per-pass growths from the logs in the PR. If any `check` or `node-range` job, on any platform, shows two passes stepping by more than 32 MiB within one run, raise the pass count to five (updating the spec scenario) and re-run.

## Workflow follow-up

- Archive the change after review and merge.
