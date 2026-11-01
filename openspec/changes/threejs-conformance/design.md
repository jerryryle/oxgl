# Design

## Context

The Khronos runner (`conformance/`) already runs browser pages under Node:

- `page.mjs` builds a jsdom window, installs oxgl's canvas shim and runs one page per forked process.
- `pool.mjs` schedules the pages and classifies how each process ended.
- `suite.mjs` fetches a pinned commit as a sparse, blobless checkout cached under `.cache/`.
- `expectations.mjs` parses and judges the checked-in expectations.

The shim already covers canvases with oxgl contexts, 2D canvases through the `canvas` package, images, workers, `OffscreenCanvas`, `ImageBitmap`, video and per-frame compositing. jsdom and `canvas` are devDependencies.

three.js's end-to-end test (`test/e2e/puppeteer.js` at the pinned tag, r186 when this was written) works as follows:

1. It loads each example in an 800×500 viewport at device pixel ratio 1, with `deterministic-injection.js` evaluated before any page script. That script seeds `Math.random`, pins `Date.now` and `performance.now` to 0, and holds `requestAnimationFrame` callbacks until the test sets `_renderStarted`.
2. It runs `clean-page.js`, which clicks any start button and hides overlays.
3. It waits for 2 s with no network activity, for videos to be ready, and for one second per megabyte loaded.
4. It releases one frame and waits up to 5 s for it, but captures even if that frame never runs.
5. It takes a screenshot and halves it to 400×250.
6. It compares the result with `examples/screenshots/<name>.jpg`. A pixel differs when its RGB distance exceeds 0.1 of the maximum, and the frame fails when 0.1% or more of its pixels differ. It also fails on page errors and `console.error`.

When the test loads `build/three.*.js`, it rewrites `Math.random() * 0xffffffff` to use the unseeded random, so UUIDs stay unique.

Examples are ES modules with an import map (`three` → `../build/three.module.js`, `three/addons/` → `./jsm/`). jsdom does not run `type="module"` scripts.

## Goals / Non-Goals

**Goals:**
- Reuse the Khronos runner's shim, process pool, fetch and expectations machinery rather than build a second harness.
- Follow upstream's frame sequence and thresholds closely enough that an example matching in Chrome also matches on a correct WebGL implementation.
- Make a run of every example fast enough to be a required CI job on Linux arm64.

**Non-Goals:**
- A layout engine. Capture reads the WebGL canvas directly, not a rendered page.
- Making jsdom pass for a full browser beyond what examples observably need. Gaps become expectations entries with reasons.

## Decisions

### D1. Share the jsdom window with the Khronos runner

The shim setup in `page.mjs` moves to `conformance/window.mjs`. That covers `installShim`, the image interceptor, workers, video, compositing and context release. `page.mjs` keeps only what belongs to the Khronos harness: `webglTestHarness`, Closure imports and the outcome rules. The three.js page script, `threejs/example.mjs`, imports the same module, so both runners give examples identical canvas, image, worker and video behaviour.

*Alternatives:* a hand-written minimal shim, which the user rejected in favour of jsdom and which would duplicate the existing one. Puppeteer and Chrome, which would test Chrome, not oxgl.

### D2. Module scripts run as `vm.SourceTextModule` in the page's context

Once parsing is done, the example script runs the document's `type="module"` scripts in order. Each one is a `vm.SourceTextModule` in the jsdom window's context. A linker resolves specifiers:

- bare and prefixed specifiers through the page's import map, by longest-prefix match (HTML §8.1.5.3);
- relative and absolute URLs against the importing module's URL.

The linker fetches every module over HTTP from the example's own server (D3), so module bytes count towards idleness and the parse allowance like any other request. `importModuleDynamically` sends dynamic `import()` through the same linker. Modules are cached by URL, so each module is evaluated once. Errors thrown while a module evaluates are reported as the page's escaped errors. The child process is forked with `--experimental-vm-modules`.

jsdom fires `DOMContentLoaded` and `load` without waiting for module scripts, which it does not run. In `beforeParse`, before any page script can register, the runner adds capturing listeners on `document` and `window` that note and stop every `DOMContentLoaded`, and every `load` whose target is the document. These are the events jsdom fires, including the repeat `load`s it fires after later image loads. After the module scripts have evaluated, the runner dispatches one `DOMContentLoaded`, then one `load` on `window` once jsdom's first `load` has been noted. The hold lets the runner's own events through: it keeps the events the runner creates in a set and does not stop those. Page listeners registered at the module's top level therefore run once, in browser order.

Because the hold stops every jsdom `load` and the runner's own `load` targets `window`, which the shim's load-once guard ("Window load fires once") ignores, the page sees exactly one `load` whichever of the two listeners was registered first.

As they load, `build/three.core.js`, `build/three.module.js` and `build/three.webgpu.js` get upstream's rewrite of `Math.random() * 0xffffffff` to the unseeded random. These are the files upstream's test rewrites, and in r186 the UUID code lives in `three.core.js`. Without the rewrite, UUID generation would consume the seeded sequence and shift every random value the example draws relative to Chrome's run.

*Alternative:* Node's own ESM loader with the window's globals copied onto `globalThis`. That runs three.js in Node's realm rather than the page's. Typed arrays, `instanceof` checks and the errors oxgl throws would then come from a different realm than the page's DOM, which conformance-testing already specifies against.

### D3. Each example process serves the checkout itself, and idleness is measured there

Each example's process starts its own instance of `conformance/server.mjs` on an ephemeral loopback port, rooted at the checkout. The server counts in-flight requests and bytes served. Any request a page makes reaches it: images, `fetch`, XHR, worker fetches and module loads (D2). That makes idleness exact, without hooking each loading path.

Requests to other origins are refused in three places: the runner's own request interceptor (ahead of the shared image interceptor), the page's `fetch`, and the worker shim. Each refusal reports its URL to the example process.

jsdom has no `fetch`, `Request` or `Response`, which three.js's loaders use. The three.js runner gives the page its own: relative URLs resolve against the document, jsdom's `AbortSignal` is bridged to Node's, and bodies come back as the page's objects (`arrayBuffer()` as the page's `ArrayBuffer`, `json()` through the page's `JSON`), since loaders test `instanceof ArrayBuffer`. The Khronos runner's minimal `fetch` stays as it is.

The worker refusal is a `sameOriginOnly` option of the shared window and worker shims, which only the three.js runner sets. With it set, the worker shim replaces the worker thread's `fetch`, which is otherwise Node's unrestricted global, with one that rejects other origins. The rule refuses only `http:` and `https:` URLs whose origin is not the example server's. `data:` and `blob:` URLs, which have no network origin, pass through, as in a browser: glTF files embed buffers as `data:` URLs, and the Draco and KTX2 loaders start their workers from `blob:` URLs. The Khronos runner leaves the option unset, because its suite deliberately loads resources from the other loopback name ("Tainted 2D canvases in the runner").

The page is idle when no request has been in flight for 1 s. That is shorter than upstream's 2 s, because upstream measures from outside the browser and we count requests at the server. Then come the video readiness check and upstream's parse allowance of 1 s per megabyte served, capped at 30 s, so the runner's own wait stays well under the time limit. After that, the runner sets `_renderStarted` and polls `_renderFinished` for up to 5 s.

The example process sends a progress message to the pool when a response completes, when the page becomes idle, when the allowance ends and when the frame is released. Each message restarts the pool's watchdog, as each result does for a Khronos page. A slow but progressing example is therefore not timed out early, while a stalled one is. An example that never goes idle, such as one that polls or streams, still ends: the pool also enforces a total limit of 5 min per example, upstream's network timeout.

*Alternative:* one server in the parent, as the Khronos runner has. It could not tell which example a request came from without tagging every URL.

### D4. Capture from the drawing buffer, not a composited page

The runner installs `deterministic-injection.js` in `beforeParse`, after the shared shim, so the injection's `requestAnimationFrame` gate replaces the shim's compositing wrapper rather than being wrapped by it. With that order the shim never presents, and so never clears, a drawing buffer before capture. The order is fixed in code, and a test that would see a cleared frame otherwise covers it. Once `_renderFinished` is set, the released callback has run and the drawing buffer still holds its frame. The runner reads that buffer through the path `toDataURL` already uses for WebGL canvases: unpremultiplied, top row first.

The capture then:

- composites the frame over `getComputedStyle(document.body).backgroundColor`, which comes from `main.css` in nearly every example and is white when transparent;
- halves the frame by averaging 2×2 blocks.

Exactly one WebGL canvas in the document, sized 800×500, is required. Any other layout fails with a message that names what was found.

### D5. Compare with upstream's algorithm and record the percentage

The `canvas` package's `loadImage` decodes the reference JPEG, so no new dependency is needed. The runner computes upstream's per-pixel distance test and records the percentage of differing pixels on every compared frame, including frames that pass. `conformance/png.mjs` encodes the captured, reference and diff images into `threejs-output/` for every example that does not pass.

### D6. Expectations: the shared module, with an optional `DIFF`

`threejs/expectations.txt` holds lines of the form `<example> <FAIL|TIMEOUT|CRASH|SKIP|DIFF n%> # <reason>`. `conformance/expectations.mjs` handles it, rather than a second copy of the parse, select, judge and update rules. It gains two options:

- a fixed suite name, used when lines have no suite column;
- `tolerances`, which admits `DIFF` entries and reads each result's `diffPercent` when updating.

The example process decides `PASS` or `FAIL` itself, comparing the difference with the example's tolerance (its `DIFF` value, or 0.1%), which the parent passes in. The judge therefore sees a `DIFF` example within its tolerance as `PASS`, its expected outcome. It also sees one within 0.1% as an unexpected pass, using `diffPercent`.

The Khronos runner passes neither option, so its format and behaviour are unchanged.

`DIFF` is what keeps the suite useful on SwiftShader. Chrome's references come from whichever GPU or rasterizer a contributor used. Many examples will differ from them by anti-aliasing and precision noise. A plain `FAIL` would stop guarding those examples, while a tolerance still catches gross regressions.

Tolerances are capped at 5%, both in the file and in what `--update` writes. Beyond 5%, a frame is too far off to call noise, so `--update` records it as `FAIL` with its percentage, and it has to be triaged by hand. That keeps an update run from turning a black frame into a passing entry.

`--update` keeps a `DIFF` entry whose example is still within it, and removes the entry only when the example matches within upstream's 0.1%. It never raises an existing tolerance. An example beyond its `DIFF` is written as `FAIL` with its percentage, so a regression shows up in the expectations diff as a new failure rather than as a changed number. An example without a `DIFF` entry gets one when its only fault is an image difference of at most 5%. That covers an example with no entry, and one whose `FAIL`, `TIMEOUT` or `CRASH` entry was fixed but left a small difference.

*Alternative:* our own reference images rendered by oxgl. That only detects change, not wrongness. It is rejected in the proposal.

### D7. Generalize the pool and the fetch, don't fork them

- `runPages` in `pool.mjs` gains two options: the arguments a page process gets, and extra `execArgv` (for `--experimental-vm-modules`). The Khronos runner passes what it does today.
- An example's progress messages (D3) use the pool's existing `counts` message, so the watchdog needs no change. Its limit is 60 s by default.
- `runPages` also gains an optional total limit per page. Reaching it kills the process and gives `TIMEOUT`, as the watchdog does. The three.js runner sets it from `--total-timeout`, 5 min by default, and the Khronos runner leaves it unset.
- `ensureSuite` in `suite.mjs` takes its sparse paths and a completeness marker. The Khronos call passes `/sdk/tests/` and `00_test_list.txt`. The three.js call passes `/build/`, `/examples/` and `/test/e2e/`, with `build/three.module.js` as the marker.

`threejs/pin.json` holds `repository`, `tag` and `commit`. The fetch uses only the commit.

### D8. Seeding the expectations

1. Upstream's exception list for non-WebGPU examples becomes `SKIP` entries with upstream's reasons, since timing and media problems in Chrome will not improve under jsdom.
2. One `--update` run on Linux arm64 with `OXGL_BACKEND=software` records the rest.
3. Every resulting `FAIL`, `TIMEOUT` and `CRASH` reason is triaged to name its cause: an oxgl defect, an ANGLE or SwiftShader issue, or a runner gap such as layout, module workers or clientWidth.
4. `--update` already records image differences above 5% as `FAIL` with their percentage. Each of those is either traced to its cause or confirmed as a rasterizer difference.

### Safety rules

This change adds no Rust and touches no `unsafe`, handle or ArrayBuffer code. Each example process releases its contexts through the shared release path before it exits, as the Khronos runner does, so any leak in normal operation shows up the same way. Crashes in oxgl stay confined to one example's process.

## Risks / Trade-offs

- [`vm.SourceTextModule` is experimental and its API has changed between Node releases] → CI pins Node, and the harness tests cover module loading, import maps, dynamic import and module errors, so a Node bump that breaks it fails loudly.
- [jsdom has no layout, so `clientWidth`, `getBoundingClientRect` and similar return 0] → Examples that size the renderer from a container fail capture with a clear message and get an entry. Giving full-viewport elements the viewport's size is a possible later extension, if many examples need it.
- [Tolerances could hide a real defect] → Tolerances are capped at 5%, every `DIFF` entry is reviewed at seeding, and an example that improves to within 0.1% is reported, so its entry gets removed.
- [The 30 s cap on the parse allowance is shorter than upstream's uncapped one] → An example with more than 30 MB of assets may still be parsing when its frame is released. Its frame then mismatches, and it gets an entry with that reason. Raising the cap is a constant change.
- [CI time on a Pi-class runner is unknown] → The first full run measures it. If the job takes much longer than the Khronos jobs, it is split into shards by name, as the Khronos jobs are split by suite.
- [The `examples/` tree is large: models, textures, HDRs] → It is fetched once per pin and cached in CI by pin. The size is recorded in `CONTRIBUTING.md` at implementation.
- [References change when the pin is bumped] → Bumping the pin is its own change, with an `--update` run and re-triage.

## Migration Plan

There is nothing to migrate. Removing the CI job's entry from the required list rolls the gate back without touching oxgl.

## Open Questions

- The idle period (1 s), the 30 s allowance cap and the default time limits (60 s, 5 min) may need tuning after the first full run on Linux arm64. Each is a constant in the runner, and the time limits can also be set per run.
