# Tasks

## 1. Shared runner code

- [x] 1.1 Move the jsdom window setup out of `conformance/page.mjs` into `conformance/window.mjs`, leaving the Khronos-only parts in `page.mjs` (design D1). The moved parts are `installShim`, the image interceptor, workers, video, compositing and context release. The Khronos-only parts are `webglTestHarness`, Closure imports and outcomes. Verify that `npm test` passes, including `test/conformance-harness.test.mjs`. Also verify that `OXGL_BACKEND=software npm run conformance -- --filter conformance/textures/` on Linux arm64 (Docker, per `CLAUDE.md`) gives the same outcomes as before.
- [x] 1.2 Let `runPages` in `conformance/pool.mjs` take each page process's arguments, extra `execArgv`, and an optional total limit per page that gives `TIMEOUT` (design D7), with the Khronos runner passing what it does today. Add harness tests for these cases:
  - a page script forked with an extra `execArgv` sees it in `process.execArgv`;
  - a page that keeps sending progress is killed at the total limit with outcome `TIMEOUT`.

  Verify with `npm test`.
- [x] 1.3 Let `ensureSuite` in `conformance/suite.mjs` take its sparse paths and completeness marker (design D7), with the Khronos call unchanged in effect. Extend the harness test for fetching to cover a custom marker. Verify with `npm test` and `npm run lint:js`.

## 2. Pin, fetch and suite listing

- [x] 2.1 Add `threejs/pin.json` (`repository`, `tag` `r186`, `commit`), and add a fetch that caches `/build/`, `/examples/` and `/test/e2e/` under `.cache/threejs/<commit>/` through `ensureSuite`. Add `threejs-results.json` and `threejs-output/` to `.gitignore`. Verify that a clean run fetches once and a second run reuses the copy. Record the download size for `CONTRIBUTING.md`.
- [x] 2.2 List the suite as every `examples/*.html` except `index.html` and `webgpu_*` (spec: The example suite). Add a test against a fixture directory. Verify with `npm test`.

## 3. Example page: window, modules and assets

- [x] 3.1 Add `threejs/example.mjs`, which builds the shared window at 800×500 with device pixel ratio 1. Each example process serves the checkout through its own `conformance/server.mjs` on an ephemeral port, counting in-flight requests and bytes served (design D3). Behind a `sameOriginOnly` option of the shared shims, which only this runner sets, requests to other origins are refused in three places: the request interceptor, the page's `fetch` shim, and the worker shim's `fetch`, which replaces Node's global `fetch` in worker threads. Add tests with fixture pages for "Renderer sized to the window", "Remote asset", "Remote fetch from a worker" and "Embedded and Blob URLs", and one showing that a worker without the option can still fetch from the other loopback origin. Verify with `npm test`.
- [x] 3.2 Run `type="module"` scripts as `vm.SourceTextModule` in the page's context (design D2):
  - after parsing, in document order, with every `DOMContentLoaded` and document-targeted `load` jsdom fires stopped by capturing listeners, and one of each dispatched once the modules have evaluated;
  - import-map resolution by longest prefix, and URL resolution against the importing module;
  - sources fetched over HTTP from the example's server, so they are counted;
  - dynamic `import()`, one evaluation per URL, and evaluation errors reported as escaped errors;
  - upstream's UUID rewrite applied to `build/three.core.js`, `three.module.js` and `three.webgpu.js`, with a test that creating a `THREE.Object3D` leaves the next seeded `Math.random()` value unchanged.

  Fork the process with `--experimental-vm-modules`. Add fixture tests for import maps, prefixed specifiers, dynamic import, cyclic imports, a module that throws, `instanceof` across the page's realm, "Module waiting for load", a module's `DOMContentLoaded` listener running once, `load` handlers running once when an image created after load finishes loading, with the hold registered both before and after the load-once guard, and module bytes appearing in the server's count. Then run the "Importing three and its addons" scenario against the pinned build. Verify with `npm test`.

## 4. Deterministic frame, capture and comparison

- [x] 4.1 Install the pinned `deterministic-injection.js` in `beforeParse` after the shared shim, so its gate replaces the shim's compositing wrapper (design D4), and run `clean-page.js` after load. Wait for a 1 s request-idle period, video readiness and the parse allowance (1 s/MB, capped at 30 s). Then release the frame and wait up to 5 s (design D3), sending a progress message at each stage and at each completed response. Add tests for:
  - "Seeded randomness": two captures identical;
  - "Example without an animation loop", which also shows that a render-on-load frame is not cleared before capture;
  - "Large assets", with the allowance's rate and cap passed in as options, so the test runs with a few milliseconds per MB and a short cap and still checks that the cap applies and that the example is not timed out.

  Verify with `npm test`.
- [x] 4.2 Capture the one 800×500 WebGL canvas's drawing buffer after the released frame, composite it over the body's computed background color, and halve it by 2×2 averaging (design D4). Fail with a message naming the layout otherwise. Add tests for a single canvas, two canvases and a wrongly sized canvas, and for compositing a transparent clear over a black and a white body. Verify with `npm test`.
- [x] 4.3 Compare with the reference JPEG, decoded with `canvas`, using upstream's per-pixel distance and the example's tolerance (0.1% by default, with the tolerance itself counting as a match). Record the percentage on every compared frame, treat a missing reference or a size mismatch as a mismatch, and write PNGs of the captured frame, the reference and the diff to `threejs-output/` for examples that do not pass (design D5). Add tests with synthetic images on both sides of each threshold and exactly at 0.1% ("Exactly at the default tolerance"). Verify with `npm test`.

## 5. Outcomes, expectations and the command

- [x] 5.1 Report each example's outcome to the pool over IPC: escaped errors and `console.error` are `FAIL`, and the pool's watchdog (60 s without progress by default, restarted by the progress messages from 4.1) and 5 min total limit give `TIMEOUT` and `CRASH`. Runner failures are harness errors. Add harness tests for "Shader compile error", "Example that never finishes loading", "Example that never goes idle", "Native crash in one example" and "Setup fails". Verify with `npm test`.
- [x] 5.2 Extend `conformance/expectations.mjs` with a fixed-suite option for files without a suite column, and a `tolerances` option (design D6). The latter covers:
  - `DIFF n%` parsing with 0.1 < n ≤ 5;
  - judging by each result's `diffPercent`, including unexpected passes within 0.1%;
  - `--update` keeping `DIFF` entries still in use, writing an example beyond its `DIFF` as `FAIL` (never raising a tolerance), and giving examples without a `DIFF` entry (none, or a fixed `FAIL`/`TIMEOUT`/`CRASH`) a `DIFF` (rounded up) for mismatches of at most 5% and `FAIL` above that;
  - the example process judging its frame against the tolerance the parent passes in (its `DIFF`, or 0.1%).

  Add `threejs/expectations.txt`. Add tests for every scenario in "Checked-in expectations", "Tolerance entries", "Runs are judged against expectations" and "Updating expectations". Verify with `npm test`, and verify that the Khronos expectations tests in `test/conformance-harness.test.mjs` pass unchanged.
- [x] 5.3 Add `threejs/run.mjs` and the `npm run threejs` script, with options to filter, include skipped examples, update, and set the jobs, `--timeout` (the limit without progress) and `--total-timeout`. It refuses to run without `dist/`, `canvas` or ffmpeg, as the conformance command does. It writes `threejs-results.json` with every field in "Results report", including both limits and, for each `TIMEOUT`, the limit it reached. Add tests for "Filtered run", "Raising the total limit", "Updating expectations" and "Default parallelism". Verify with `npm test` and `npm run lint:js`.
- [x] 5.4 Document `npm run threejs` in `CONTRIBUTING.md` next to the conformance section: the pin, the cache and its size, the frame sequence, the expectations format with `DIFF`, the output images, and how to triage an entry. Verify that every documented command runs as written.

## 6. Seeded expectations on Linux arm64

- [x] 6.1 Add upstream's non-WebGPU exception-list entries as `SKIP`, with upstream's reasons (design D8).
- [x] 6.2 Run `OXGL_BACKEND=software npm run threejs -- --update` on Linux arm64 (Docker, per `CLAUDE.md`). Triage every `FAIL`, `TIMEOUT` and `CRASH` reason to name its cause: an oxgl defect, ANGLE or SwiftShader, or a runner gap. Include the image mismatches above 5% that `--update` writes as `FAIL`. Record the run time per example and in total. Verify that a second full run without `--update` passes, and that two consecutive runs give identical outcomes.

## 7. CI

- [x] 7.1 Add a `threejs` job to `.github/workflows/ci.yml` on `ubuntu-24.04-arm`: build, restore `.cache/threejs` keyed by `hashFiles('threejs/pin.json')`, run with `OXGL_BACKEND=software`, and upload `threejs-results.json` and `threejs-output/` whatever the result. Gate it like the other heavy jobs and add it to the aggregate `ci` check's needs and required list. If the measured run time from 6.2 exceeds the slower Khronos job, shard by example name. Update the CI table in `CONTRIBUTING.md`. Verify with actionlint.

## 8. Integration

- [x] 8.1 Mention `npm run threejs` and the current pass, `DIFF` and fail counts in `README.md`'s three.js section. Then run `npm run lint`, `npm test`, `OXGL_BACKEND=software npm run conformance` and `OXGL_BACKEND=software npm run threejs` on Linux arm64, and verify that all of them pass.
