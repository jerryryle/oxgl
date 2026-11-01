# Proposal

## Why

three.js is oxgl's most important client. oxgl tests it in two ways today:

- `test/threejs.test.mjs` checks pixels from nine hand-written scenes: basic scenes, textures, render targets, instancing, shadows and context loss.
- `npm run bench` times two scenes without checking their output.

Passing the Khronos suites shows the API behaves to spec. Neither of these shows that the wider range of shader, material, loader, post-processing and extension paths three.js uses produces the right images.

three.js has no conformance suite of its own. Its end-to-end test (`test/e2e/puppeteer.js`) comes closest. It renders every example in `examples/` as one deterministic frame in headless Chrome and diffs that frame against a reference screenshot kept in the repository (`examples/screenshots/*.jpg`). Those references are Chrome's output, so they can serve as browser-equivalent expectations for oxgl, without any browser in the loop.

## What Changes

- **A pinned three.js release.** `threejs/pin.json` names one three.js release tag and its commit. The runner fetches that commit's `build/`, `examples/` and `test/e2e/` once, caches them under `.cache/threejs/<commit>/`, and never commits them to oxgl.
- **The examples run in Node, under jsdom, against oxgl.** Each example page gets the same jsdom window and canvas shim the Khronos runner uses: canvases with oxgl contexts, images, workers and video. This change adds what the examples need on top:
  - an 800×500 viewport at device pixel ratio 1;
  - `<script type="module">` with the page's import map, which jsdom does not run itself;
  - the assets served from the pinned checkout, with `http:` and `https:` requests to any other origin refused, while `data:` and `blob:` URLs load as in a browser.
- **The same deterministic frame as upstream.** The runner injects three.js's own `deterministic-injection.js` and `clean-page.js` from the pinned checkout, which pin `Math.random`, freeze the clock, hide UI overlays and gate `requestAnimationFrame`. It then follows the upstream sequence: wait for loads to finish, release one animation frame, capture.
- **Diffed against the upstream reference screenshots.** The runner reads the page's WebGL canvas as it would be presented, composites it over the page background and halves it to 400×250, as upstream does. It then compares the result with the pinned reference JPEG using upstream's per-pixel threshold and different-pixel limit. On failure it writes the actual, expected and diff images for inspection.
- **Checked-in expectations, with per-example tolerances.** `threejs/expectations.txt` uses the Khronos expectations format and outcomes (`FAIL`, `TIMEOUT`, `CRASH`, `SKIP`), plus a tolerance entry. A tolerance entry lets an example pass with up to a stated percentage of differing pixels, at most 5%. With it, an example that differs from Chrome only by rasterization noise still catches regressions, instead of sitting at `FAIL` and catching nothing.
- **`npm run threejs`** runs the examples in parallel, one process per example, using the Khronos runner's pool and outcome rules. Each example also has a 5 min total limit on top of the pool's 60 s limit without progress. It judges the outcomes against the expectations and writes `threejs-results.json`. It has the conformance command's options (filter, update, include skipped, jobs and timeout), plus a total timeout.
- **A required CI job** runs the examples on Linux arm64 with `OXGL_BACKEND=software` and uploads the report and the failing examples' images.
- **Shared runner code.** The jsdom window setup in `conformance/page.mjs` moves into a module that both runners import. `conformance/expectations.mjs` gains optional tolerance support and a mode without the suite column, so both runners share it. The Khronos runner's behaviour is unchanged.

## Capabilities

### New Capabilities
- `threejs-examples`: running three.js's own examples on oxgl under Node and judging each rendered frame against the release's reference screenshots and the checked-in expectations.

### Modified Capabilities
- `continuous-integration`: a required job runs the three.js examples on Linux arm64 and uploads their report, and the Triggers requirement lists it among the jobs a documentation-only change skips.

## Impact

- New: `threejs/` (`pin.json`, `expectations.txt`, the runner and its page script), and harness tests under `test/`.
- Changed: `conformance/page.mjs`, whose shared window shim moves into a module both runners use; `conformance/expectations.mjs`, `pool.mjs` and `suite.mjs`, which gain options for the three.js runner; the worker shim, whose `fetch` stays on the page's origin; `package.json` (a `threejs` script); `.github/workflows/ci.yml` (a new job, gated like the other heavy jobs and required by `ci`); `.gitignore` (`threejs-results.json`, the image output directory); `CONTRIBUTING.md` and `README.md`.
- Dependencies: none new. jsdom and `canvas` are already devDependencies, and `canvas` decodes the reference JPEGs. The `three` devDependency used by `npm run bench` is independent of the pin.
- oxgl itself does not change. Defects the examples reveal get their own changes, and each expectations entry names its cause.
- CI cost: about 380 example pages in r186 on SwiftShader per run. The download is large but cached by pin.

## Out of Scope and Extension Points

- **WebGPU examples** (`webgpu_*`) are not in the suite. oxgl is WebGL only.
- **three.js unit tests** (`test/unit`) are left out, since they barely touch WebGL.
- **Fixing the failures the suite finds.** Those get their own changes.
- **Interaction, XR sessions, audio and webcams.** Examples that need them are `SKIP` with a reason, and so are the examples upstream itself excludes.
- **Layouts with more than one canvas, or with CSS-rendered content** (`css2d_*`, `css3d_*`, `svg_*`). jsdom has no layout engine, so the runner captures only a single full-viewport WebGL canvas. Such examples get an expectations entry. Compositing several canvases is left for later work.
- **Module workers.** Classic workers work as in the Khronos runner. Examples that need `new Worker(url, { type: 'module' })` fail with a recorded reason until the worker shim supports modules.
- **References made with oxgl.** The reference images stay upstream's Chrome screenshots. Generating oxgl-specific references would test only for regressions, not for correctness.
- **GPU backends.** CI runs SwiftShader. A GPU run can reuse the command once a GPU runner exists.
- **Bumping the pin.** The pin is a single tag in `threejs/pin.json`. Bumping it is a later change that also updates the expectations.
