# Tasks

## 1. Test

- [ ] 1.1 Change `dropped contexts are reclaimed` in `test/soak.test.mjs` to run three measured passes after the warm-up. Measure RSS after a forced GC before the first pass and after each one; after every pass, assert that `liveContexts()` equals the pre-test value; assert that the smallest per-pass growth is at most 32 MiB; and report all three growths in a diagnostic. Verify that `OXGL_BACKEND=software npm test` passes locally, and that `npm run lint:js` is clean.
- [ ] 1.2 Check that the test still catches a leak: temporarily retain every dropped context's native resources (for example, skip the deletion-queue drain on finalization) and confirm that the test fails with a large per-pass growth. Then revert the change.

## 2. CI verification

- [ ] 2.1 Re-run the PR's CI at least three times. Verify that `check` (Linux, macOS, Windows) and `node-range` (22.12.0, 26) pass every time, and record the per-pass growths from the logs in the PR.

## Workflow follow-up

- Archive the change after review and merge.
