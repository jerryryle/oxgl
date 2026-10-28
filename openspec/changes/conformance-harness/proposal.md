# Proposal

## Why

oxgl promises to behave exactly as a browser's WebGL does, and the Khronos WebGL conformance suite is the definition of that behaviour. Specs cite conformance tests, but nothing runs them. Every API change still to come (buffers, shaders, textures, framebuffers, drawing, WebGL 2) needs an objective measure of progress and a guard against regressions, so the harness has to land before those changes.

## What Changes

- Pin a revision of the Khronos WebGL conformance suite (`KhronosGroup/WebGL`, `sdk/tests`) in the repository. Fetch it on demand into a local cache; do not vendor it.
- Add a Node runner that loads each test page in jsdom. A small canvas shim makes `canvas.getContext('webgl' | 'experimental-webgl' | 'webgl2')` return oxgl contexts. The runner collects results through the suite's own `webglTestHarness` reporting hooks and runs each page in its own child process with a timeout, so a crash or hang affects only that page.
- Run two suites: WebGL 1 (the 1.0.x test list with WebGL 1 contexts) and WebGL 2 (the 2.0.x test list, which includes `conformance/` run against WebGL 2 contexts).
- Add a checked-in expectations file listing every page that is not expected to pass, each with its status (`FAIL`, `TIMEOUT`, `CRASH`, `SKIP`) and a reason. A normal run fails on any difference from the expectations: a regression or an unexpected pass. The list therefore only shrinks as the API is filled in. Skipped pages that are explicitly included are reported without being judged, and an update run is judged against the file it writes.
- Add `npm run conformance` with options to filter pages, choose a suite, and rewrite the expectations from a run. The run writes a JSON results report.
- Add a required `conformance` CI job: Linux arm64, `OXGL_BACKEND=software`, both suites, report uploaded as a workflow artifact.

## Capabilities

### New Capabilities
- `conformance-testing`: How oxgl is measured against the Khronos WebGL conformance suites: the pinned suite revision, how pages are run under Node, how results are judged against checked-in expectations, and the developer commands.

### Modified Capabilities
- `continuous-integration`: Adds a required conformance job.

## Impact

- New: `conformance/` (runner, canvas shim, suite pin, expectations), `.github/workflows/ci.yml` conformance job, `npm run conformance` script.
- New devDependency: `jsdom` (MIT). It is test-only and never ships, so the licensing allowlist does not apply. Neither do the Khronos tests, which are fetched at test time and not distributed.
- The `engines` floor rises from Node 22.12.0 to 22.22.2, the oldest Node 22 that jsdom 30 supports, because the harness tests run in `npm test`, which `node-range` runs on the floor.
- No change to the oxgl API or native code. Nearly every page fails today, so the first expectations file lists almost the whole suite. Later changes remove entries as they make pages pass.
- `CONTRIBUTING.md` documents running a subset locally and updating expectations.

## Out of Scope and Extension Points

- **Making tests pass.** This change only measures. Every API change that follows updates the expectations.
- **DOM media sources.** Pages that need decoded images, video, `ImageBitmap`, `OffscreenCanvas` or 2D canvas get no support from the shim and stay in the expectations. Whether oxgl supports any of these is a later product decision. The shim is the extension point.
- **Canvas resizing.** Setting `canvas.width`/`height` after `getContext` is not forwarded to the context, because oxgl cannot resize a drawing buffer yet. Pages that do this fail until a later change adds resizing.
- **Per-subtest expectations.** Results are judged per page, not per assertion. The JSON report records per-page pass/fail counts for visibility, but they do not gate CI.
- **GPU and non-Linux conformance runs.** The CI job runs SwiftShader on Linux arm64 only. The existing `gpu` job slot and the other platforms can add conformance runs later with their own expectations.
- **Extension conformance** (`conformance/extensions/`) runs like any other page. Making it pass belongs to the extensions change.
