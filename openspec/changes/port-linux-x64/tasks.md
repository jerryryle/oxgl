# Tasks

## 1. ASan on x64

- [ ] 1.1 Add `symbols_url` and `symbols_sha256` for `linux-x64` to `angle/bundles.toml`, from the `angle-8078.4` release's `SHA256SUMS`. Verify that `python3 angle/scripts/check_pin.py` passes and that the x64 ASan job (survey workflow, `OXGL_ANGLE_SYMBOLS=1`, `-Zbuild-std --target x86_64-unknown-linux-gnu`) reports no leak. If the leak is still reported, check whether its stack reaches ANGLE's frames: if not, set `fast_unwind_on_malloc=0` in the survey's x64 `ASAN_OPTIONS` (as on arm64) and record it here for linux-arm64-focus task 4.5 to apply when it re-enables the x64 ASan job; otherwise propose a narrow x64 entry. Update the suppression file's comment to the platforms it is seen on.

## 2. Abort reported as TIMEOUT

- [ ] 2.1 On a scratch branch (never merged), in a workflow of its own that does not run the regular CI, build oxgl on `ubuntu-24.04` and run the `abort.html` fixture through the page runner with timing and the page's stderr: as is, with core processing disabled (`ProcessSizeMax=0`, or `kernel.core_pattern` pointed away from systemd-coredump), and with Node's backtrace output captured. Record the cause here.
- [ ] 2.2 Add the fix for the recorded cause as a task here and have the user review it, then make it, with a harness test that fails without it where one can.

## 3. Build-and-test survey

- [ ] 3.1 In the scratch workflow, run `npm ci`, `npm run build`, `npm run lint:rust`, `npm run lint:js`, `cargo test --workspace --exclude oxgl-node --locked`, `npm test` (`OXGL_BACKEND=software`, ffmpeg installed) and the x64 ASan job on `ubuntu-24.04`. Iterate until green; any further fix is added here and reviewed first. Record the passing run here. When port-windows and port-linux-x64 are applied together, one scratch workflow with a platform matrix serves both, with one Linux arm64 reference leg.

## 4. Conformance comparison

- [ ] 4.1 After linux-arm64-focus task 4.4 restores the time-limit margin, run both conformance suites in the same workflow on `ubuntu-24.04` and `ubuntu-24.04-arm` on one commit, uploading every report. Compare the reports page by page. Before attributing a difference, re-run each differing page alone (`--jobs 1`) with a long limit (`--timeout 120`) on the same runner: a page that then passes is slow on that runner, not different, as with the macOS comparison (linux-arm64-focus task 4.3). Record those pages too, with their longest gap at the default settings and alone, for the CI decision in linux-arm64-focus task 4.6. Record every remaining differing page here with its outcome on each platform and its cause.
- [ ] 4.2 Fix each difference that is an oxgl bug (added as a task and reviewed first), and propose how to record each remaining platform-specific expectation for the user to agree. Re-run 4.1 until every difference is fixed or agreed. Delete the scratch branch.

## 5. Wrap-up

- [ ] 5.1 Record the results in linux-arm64-focus task 4.5, the platform's restore, and verify with `npx openspec validate port-linux-x64 --strict`.
