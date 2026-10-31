# Tasks

## 1. Fixes

- [ ] 1.1 In `conformance/pool.mjs`, make `isNativeAbort` also accept exit code 134 on Windows, with a comment citing Node's `ExitCode::kAbort`. Make the abort-at-teardown assertion in `test/conformance-harness.test.mjs` accept `code 134`. Verify that `npm test` still passes on macOS.
- [ ] 1.2 Add `.gitattributes` with `* text=auto eol=lf` and run `git add --renormalize .`, committing any file it changes with the attributes. Verify that `git ls-files --eol` reports no `i/crlf` file.

## 2. Build-and-test survey

- [ ] 2.1 On a scratch branch (never merged), add a workflow of its own that does not run the regular CI and runs `npm ci`, `npm run build`, `npm run lint:rust`, `npm run lint:js`, `cargo test --workspace --exclude oxgl-node --locked` and `npm test` (`OXGL_BACKEND=software`) on `windows-2025` and `windows-11-arm`, with ffmpeg installed. Iterate until both are green; any fix beyond 1.1 and 1.2 is added here and reviewed before it is made. Record the passing run here. When port-windows and port-linux-x64 are applied together, one scratch workflow with a platform matrix serves both, with one Linux arm64 reference leg.

## 3. Conformance comparison

- [ ] 3.1 After linux-arm64-focus task 4.4 restores the time-limit margin, run both conformance suites in the same scratch workflow on `windows-2025`, `windows-11-arm` and `ubuntu-24.04-arm` on one commit, uploading every report. Compare each Windows report with the Linux arm64 one page by page. Before attributing a difference, re-run each differing page alone (`--jobs 1`) with a long limit (`--timeout 120`) on the same runner: a page that then passes is slow on that runner, not different, as with the macOS comparison (linux-arm64-focus task 4.3). Record those pages too, with their longest gap at the default settings and alone, for the CI decision in linux-arm64-focus task 4.6. Record every remaining differing page here with its outcome on each platform and its cause.
- [ ] 3.2 Fix each difference that is an oxgl bug (added as a task and reviewed first), and propose how to record each remaining platform-specific expectation for the user to agree. Re-run 3.1 until every difference is fixed or agreed. Delete the scratch branch.

## 4. Wrap-up

- [ ] 4.1 Record the results in linux-arm64-focus task 4.5, the platform's restore; sync this change's specs and verify with `npx openspec validate port-windows --strict`.
