# Tasks

## 1. Runner

- [x] 1.1 Count served bytes in `conformance/server.mjs` from the file size it stats, for successful non-`HEAD` responses that finish. Add a fixture page that loads a file and draws only a delay after it arrives, the delay shorter than the allowance for the bytes served (set through `timing`, as the existing tests do), and a test that it passes. Check that the test fails before the fix. Add a test that the server's `activity().bytes` equals the bytes it served, with a 404 and a `HEAD` request adding none. Verify with `npm test` and `npm run lint`.

## 2. Linux arm64

- [x] 2.1 On Linux arm64 (Docker, per `CLAUDE.md`), run `webgl_loader_gltf_transmission` 20 times before the fix and 20 times after, under CI-like load (a Docker `--cpus` limit, or alongside the rest of the suite), and record each failure rate and the allowance the fix gives it. If no run fails before the fix, raise the load (fewer CPUs, more copies at once) until some do; if none can be made to fail, stop and report. If failures remain after the fix, stop and report. Then run `OXGL_BACKEND=software npm run threejs` and check that it passes against unchanged expectations, that `webgl_loader_gltf_transmission` passes within its `DIFF 1%` entry, that no example newly times out, and report the suite's run time before and after.

## 3. Expectations

- [x] 3.1 From that run, list every `FAIL` or `DIFF` entry that now passes or whose difference changed, and every example whose frame lacked late-loaded content before, comparing frames against references. Report candidates to the user; change no entry without approval.
