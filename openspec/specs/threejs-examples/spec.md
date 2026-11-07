# threejs-examples Specification

## Purpose
Measures how well three.js renders on oxgl by running three.js's own examples under Node and judging each rendered frame against the release's reference screenshots and a checked-in record of which examples are expected to match.

## Requirements

### Requirement: Pinned three.js release
The repository SHALL pin one three.js release by commit hash, recording the release's tag alongside it. A run SHALL use only that commit's `build/`, `examples/` and `test/e2e/` trees, obtained by commit hash, with the bytes the commit stores on every host, fetched once and reused while the pin is unchanged. They SHALL NOT be committed to the oxgl repository.

#### Scenario: Release fetched by pinned commit
- **WHEN** a developer runs the three.js command on a clean checkout
- **THEN** it obtains `build/`, `examples/` and `test/e2e/` at the pinned commit, reuses that copy on later runs, and fetches again only when the pin changes

#### Scenario: Windows host converting line endings
- **WHEN** the release is fetched on a Windows host whose Git configuration sets `core.autocrlf=true`
- **THEN** every example, shader and model is served with the same bytes as on Linux, so the parse allowance and the loaders see the same input

### Requirement: The example suite
The suite SHALL be every `examples/*.html` page of the pinned release except `index.html` and pages whose name starts with `webgpu_`. An example is named by its file name without `.html`.

#### Scenario: WebGPU examples excluded
- **WHEN** the suite is listed
- **THEN** it contains `webgl_animation_keyframes` and no example whose name starts with `webgpu_`

### Requirement: Examples see a desktop browser viewport
Each example SHALL run in a window whose `innerWidth` is 800, `innerHeight` is 500 and `devicePixelRatio` is 1, which is the viewport three.js's end-to-end test uses. Canvases SHALL get oxgl contexts, and images, workers and video SHALL behave as in the Khronos conformance runner (conformance-testing).

#### Scenario: Renderer sized to the window
- **WHEN** an example calls `renderer.setPixelRatio(window.devicePixelRatio)` and `renderer.setSize(window.innerWidth, window.innerHeight)`
- **THEN** its WebGL context's drawing buffer is 800×500

### Requirement: Module scripts and import maps
An example's `<script type="module">` elements SHALL run as ES modules in the page's own realm, in document order, after parsing and before `DOMContentLoaded` and `load` reach the page, as in a browser (HTML §8.1.3.6, §8.4.1). Specifiers SHALL resolve through the page's `<script type="importmap">` (HTML §8.1.5.3), and modules, including dynamic `import()`, SHALL load over HTTP from the page's origin.

#### Scenario: Importing three and its addons
- **WHEN** an example's import map maps `three` to `../build/three.module.js` and `three/addons/` to `./jsm/`, and its module imports `OrbitControls` from `three/addons/controls/OrbitControls.js`
- **THEN** both modules load from the pinned checkout and the example renders, with `THREE.WebGLRenderer` creating an oxgl context

#### Scenario: Module waiting for load
- **WHEN** an example's module calls `window.addEventListener('load', init)` at its top level
- **THEN** `init` runs once, after the module has evaluated

#### Scenario: Error in a module
- **WHEN** a module an example imports throws while evaluating
- **THEN** the error is recorded as the example's escaped error

### Requirement: Assets from the pinned checkout only
An example's `http:` and `https:` requests, from the page or its workers, SHALL be served from the pinned checkout. Such a request to any other origin SHALL fail as a network error, and the first such URL SHALL be recorded with the example's result. `data:` and `blob:` URLs SHALL load as in a browser.

#### Scenario: Remote asset
- **WHEN** an example loads a texture from another host
- **THEN** the load fails in the page without contacting that host, and the example's report entry names the URL

#### Scenario: Embedded and Blob URLs
- **WHEN** an example loads a glTF file whose buffers are base64 `data:` URLs, and starts a decoder worker from a `blob:` URL
- **THEN** both load, and nothing is recorded as a refused request

#### Scenario: Remote fetch from a worker
- **WHEN** an example's worker calls `fetch` with a URL on another host
- **THEN** the fetch rejects without contacting that host, and the example's report entry names the URL

### Requirement: The deterministic frame
Each example SHALL run with the pinned `test/e2e/deterministic-injection.js` installed before any page script, and its `requestAnimationFrame` gate replacing the runner's. After load, `test/e2e/clean-page.js` runs. The runner waits until no request is pending, every video is ready and upstream's parse allowance (1 s per MB served, at most 30 s) has passed. It releases one animation frame and waits up to 5 s for it, then captures either way.

#### Scenario: Seeded randomness
- **WHEN** an example places objects with `Math.random()` and is run twice
- **THEN** both runs capture the same frame

#### Scenario: Example without an animation loop
- **WHEN** an example renders once on load and never calls `requestAnimationFrame`
- **THEN** the frame is captured 5 s after the release, and the example is judged on the frame it rendered on load

#### Scenario: Large assets
- **WHEN** an example loads 80 MB of models and textures
- **THEN** the parse allowance is 30 s, and the example is not timed out by the runner's own waits

#### Scenario: Allowance from the bytes served
- **WHEN** an example is served 4 MB in all and draws its content 3 s after its last load arrives (cf. three.js `webgl_loader_gltf_transmission`, whose model is decoded after the idle wait)
- **THEN** the runner releases the frame no sooner than 4 s after the idle wait, and the frame shows the content

### Requirement: The captured frame
The captured frame SHALL be the viewport after the released animation frame: the body's background, with each WebGL canvas composited onto it (Canvases composited like a browser) at its place (Canvas placement), halved to 400×250 by averaging 2×2 blocks, as upstream scales its screenshots. A document with no WebGL canvas, or with a canvas that extends past the 800×500 viewport, SHALL produce `FAIL`.

#### Scenario: Example with a single full-window renderer
- **WHEN** an example renders a red cube on black into one 800×500 canvas
- **THEN** the captured frame is 400×250 and shows the cube where Chrome shows it

#### Scenario: Example with two canvases
- **WHEN** an example renders into two WebGL canvases of 400×500, each in a sibling container at the top-left (cf. three.js `webgl_camera_logarithmicdepthbuffer`)
- **THEN** the captured frame shows them side by side, the first at the left edge

#### Scenario: Canvas past the viewport
- **WHEN** an example's canvases are 800×500 each, side by side
- **THEN** its outcome is `FAIL` with a message giving the canvas sizes and places found

### Requirement: Comparison with the reference screenshot
A captured frame SHALL match when the share of its pixels that differ from the pinned `examples/screenshots/<example>.jpg` is at most its tolerance (Tolerance entries), 0.1% by default. A pixel differs when its RGB distance from the reference, as a fraction of the maximum, exceeds 0.1. These are upstream's thresholds, with 0.1% itself counting as a match. A missing reference or a size mismatch SHALL be a mismatch, and every mismatch SHALL record the percentage of differing pixels.

#### Scenario: Rasterization noise within the threshold
- **WHEN** a frame differs from its reference in 0.05% of pixels
- **THEN** it matches

#### Scenario: Exactly at the default tolerance
- **WHEN** an example without a `DIFF` entry differs from its reference in exactly 0.1% of pixels
- **THEN** it matches, and a `DIFF` example at 0.1% is an unexpected pass

#### Scenario: Missing reference
- **WHEN** the pinned release has no screenshot for an example
- **THEN** the example's outcome is `FAIL` with a message naming the missing file

### Requirement: Example outcome
Each example run SHALL have one outcome. `CRASH`: its process died from a signal or abort the runner did not send. `TIMEOUT`: it went the limit without progress (default 60 s; progress is a response, idleness, the allowance ending, the release) or reached the total limit (default 5 min). `FAIL`: a script error escaped, `console.error` was called, or the frame did not match within its tolerance; its first error or difference is recorded. `PASS`: otherwise.

#### Scenario: Shader compile error
- **WHEN** three.js logs a shader compile failure with `console.error` and the frame otherwise matches
- **THEN** the outcome is `FAIL` with the logged message, as in upstream's test

#### Scenario: Example that never finishes loading
- **WHEN** an example keeps a request pending forever
- **THEN** its outcome is `TIMEOUT` and the run continues with the next example

#### Scenario: Example that never goes idle
- **WHEN** an example fetches a file every 500 ms for as long as it runs
- **THEN** its outcome is `TIMEOUT` at the total limit (5 min after it started, by default), and the run continues

### Requirement: Runner errors are not example outcomes
When the runner's own code fails for an example, the run SHALL fail with a harness error that names the example and the error. The other examples SHALL still run, and the report SHALL still be written. The update option SHALL NOT write a harness error to the expectations.

#### Scenario: Setup fails
- **WHEN** the runner throws while preparing an example's window
- **THEN** the run fails reporting a harness error for that example, and every other example runs and appears in the report

### Requirement: Examples are isolated
Each example SHALL run in its own process with fresh global state. A crash, hang or leaked resource in one example SHALL NOT change another example's outcome or stop the run.

#### Scenario: Native crash in one example
- **WHEN** an example makes the Node process running it abort
- **THEN** that example's outcome is `CRASH`, and every other example runs and is judged normally

### Requirement: Checked-in expectations
The repository SHALL hold an expectations file listing every example not expected to `PASS`. Each entry SHALL give the example, an expectation (`FAIL`, `TIMEOUT`, `CRASH`, `SKIP`, or a tolerance `DIFF <p>%` with `p` above 0.1 and at most 5) and a non-empty reason. A `SKIP` example SHALL NOT run unless requested, and SHALL then be reported but not judged.

#### Scenario: Entry without a reason
- **WHEN** the expectations file contains an entry with no reason
- **THEN** the command fails before running any example and names the entry

#### Scenario: Tolerance too large
- **WHEN** the expectations file contains `DIFF 20%`
- **THEN** the command fails before running any example and names the entry, since a frame that far off is a failure to triage, not noise

#### Scenario: Skipped example
- **WHEN** an example is listed as `SKIP` and the developer does not ask to include skipped examples
- **THEN** it is not run and is reported as skipped

### Requirement: Tolerance entries
An example's tolerance SHALL be `p`% when it has a `DIFF <p>%` entry, and upstream's 0.1% otherwise. A frame that differs in at most its tolerance matches, so an example with a `DIFF` entry is expected to `PASS`. Above `p`%, its outcome is `FAIL`.

#### Scenario: Within the tolerance
- **WHEN** an example listed as `DIFF 2%` differs from its reference in 1.4% of pixels and logs no error
- **THEN** its outcome is `PASS`

#### Scenario: Regression past the tolerance
- **WHEN** a change makes that example differ in 4% of pixels
- **THEN** its outcome is `FAIL` and the run reports it as a regression

### Requirement: Runs are judged against expectations
A run SHALL succeed only when every non-`SKIP` example it ran had its expected outcome. It SHALL fail and name each regression, each unexpected pass, and each different non-`PASS` outcome. A `DIFF` example that matches within upstream's 0.1% limit is an unexpected pass. A whole-suite run SHALL also fail on an entry naming no example in the suite.

#### Scenario: Unexpected pass
- **WHEN** a change makes an example listed as `FAIL` or `DIFF 3%` match within 0.1%
- **THEN** the run fails and names the example, so its entry is removed in the same change

#### Scenario: Stale entry
- **WHEN** the expectations file lists an example the pinned release no longer has
- **THEN** a whole-suite run fails and names the entry

### Requirement: Results report
Every run SHALL write a machine-readable report recording, per example, the outcome, the percentage of differing pixels when a frame was compared, the duration, the first error or message, and the reason of any expectations entry that applies on the run's platform. It SHALL also record the pinned tag and commit, the requested backend, both time limits, the parallelism, the platform (named as in platform-limited expectations) and the timestamp. Each `TIMEOUT` SHALL name the limit it reached.

#### Scenario: Timeout names its limit
- **WHEN** an example keeps a request pending forever
- **THEN** its report entry is `TIMEOUT` and names the limit without progress, and the report records both limits

#### Scenario: Reason recorded for a skipped example
- **WHEN** `css3d_youtube` is listed as `SKIP # upstream: video hangs CI` and the run does not include skipped examples
- **THEN** its report entry records the outcome `SKIP` and the reason "upstream: video hangs CI"

#### Scenario: Platform named as in the expectations
- **WHEN** the suite runs on macOS arm64 or Windows x64
- **THEN** the report records the platform as `macos-arm64` or `windows-x64`, as the conformance report does, not Node's `darwin-arm64` or `win32-x64`

### Requirement: Images of failing examples
For every example that did not `PASS`, the run SHALL write its captured, reference and diff images to an output directory.

#### Scenario: Images after a mismatch
- **WHEN** an example's frame does not match
- **THEN** the output directory holds that example's captured frame, its reference and a diff image marking the differing pixels

### Requirement: Three.js command
The root `package.json` SHALL expose `npm run threejs`, which runs the suite against the built package and exits non-zero when the run fails. It SHALL accept options to filter examples by name substring, include `SKIP` examples, set each time limit (without progress, and total) and the parallelism, and rewrite the expectations. A filtered run SHALL judge only the examples it ran.

#### Scenario: Filtered run
- **WHEN** a developer runs the command filtered to `webgl_shadowmap`
- **THEN** only examples whose names contain that string run, and other entries are neither checked nor reported stale

#### Scenario: Raising the total limit
- **WHEN** a developer runs the command with the total limit set to 10 min, and an example progresses steadily for 6 min before capture
- **THEN** the example is judged on its frame instead of timing out, and the report records 10 min as the total limit

#### Scenario: Updating expectations
- **WHEN** a developer runs the command with the update option
- **THEN** entries for the examples that ran are rewritten from their outcomes. Unchanged entries, including `DIFF` entries of examples within their tolerance, keep their reasons. Entries of examples that match within 0.1% are removed. An example without a `DIFF` entry whose only fault is an image difference of at most 5% gets `DIFF` at that percentage, rounded up to a whole percent, with the percentage as its reason. An existing tolerance is never raised: an example beyond its `DIFF` is written as `FAIL`. Other entries take the first error or the percentage, reduced to one line of at most 200 characters

#### Scenario: Update keeps a tolerance in use
- **WHEN** an example listed as `DIFF 2%` differs in 1.4% of pixels and the developer runs the update
- **THEN** its `DIFF 2%` entry and reason are kept, and a later run without the update passes

#### Scenario: Fixed failure gets a tolerance
- **WHEN** an example listed as `FAIL` for a shader error now logs no error and differs in 1.8% of pixels, and the developer runs the update
- **THEN** its entry becomes `DIFF 2%` with a reason giving 1.8%

#### Scenario: Update does not loosen a tolerance
- **WHEN** an example listed as `DIFF 2%` differs in 4.3% of pixels and the developer runs the update
- **THEN** its entry becomes `FAIL` with a reason giving 4.3%, not `DIFF 5%`

### Requirement: Examples run in parallel
The command SHALL run examples in parallel. It SHALL default to the same number of examples at once as the conformance command runs pages (conformance-testing, Pages run in parallel), and an option SHALL set that number.

#### Scenario: Default parallelism
- **WHEN** a developer runs the command without the parallelism option on a machine with 4 CPUs and 16 GiB of memory available to the process
- **THEN** up to 4 examples run at once, and the report records 4

### Requirement: Backend follows the environment
The runner SHALL create contexts with the backend selected by `OXGL_BACKEND` (backend-selection), and the report SHALL record that requested backend (`auto` when unset).

#### Scenario: Software run
- **WHEN** the command runs with `OXGL_BACKEND=software`
- **THEN** every context the examples create renders with SwiftShader and the report records `software`

### Requirement: Canvas placement
A WebGL canvas's origin SHALL be its parent's box origin (Element boxes from CSS). Canvases with the same origin SHALL sit side by side in document order, left to right from that origin, as in a flex or inline row. Pixels no canvas covers SHALL show the body's background.

#### Scenario: Side-by-side canvases
- **WHEN** an example renders into three WebGL canvases, each 264×500, in sibling containers at the top-left (cf. three.js `webgl_reversed_depth_buffer`)
- **THEN** the captured frame shows them left to right from the left edge, and the 8 pixels right of them show the page's background

#### Scenario: Canvas below a header
- **WHEN** an example's only canvas is 800×430 in a container at `position: absolute; top: 70px` (cf. three.js `webgl_postprocessing_fxaa`)
- **THEN** the captured frame shows the page's background in the top 70 rows and the canvas below them

### Requirement: Canvases composited like a browser
Each canvas SHALL be read from its raw drawing buffer and composited over the body's computed background color, which is white when transparent, as a browser composites it: a context with `premultipliedAlpha` contributes `rgb + background × (1 − a)`, and one without it `rgb × a + background × (1 − a)`, each channel clamped to 255.

#### Scenario: Premultiplied buffer with alpha below its colour
- **WHEN** a context created with `alpha: true, premultipliedAlpha: true`, as three.js r186 always creates one, holds a pixel (255, 109, 36, 21) and the body is black
- **THEN** that pixel is captured as (255, 109, 36), as a browser shows it (cf. three.js `webgl_materials_blending_custom`)

#### Scenario: Unpremultiplied buffer
- **WHEN** a context created with `premultipliedAlpha: false` holds a pixel (255, 0, 0, 128) and the body is white
- **THEN** that pixel is captured as (255, 127, 127)

### Requirement: Element boxes from CSS
Element sizes and offsets SHALL come from CSS in pixels or percent (`width`, `height`, and `top`, `right`, `bottom`, `left` with `position: absolute` or `fixed`), resolved against the containing block, the viewport for `html`, `body` and unpositioned ancestors. An unset width SHALL be the space between `left` and `right`, else the containing block's width; an unset height the space between `top` and `bottom`, else 0. A canvas keeps its existing size.

#### Scenario: Container between a header and the bottom
- **WHEN** an example's stylesheet gives `#container` `position: absolute; top: 70px; bottom: 0px; width: 100%` (cf. three.js `webgl_postprocessing_fxaa` and `webgl_multisampled_renderbuffers`)
- **THEN** `container.offsetWidth` is 800, `container.offsetHeight` is 430, and `container.getBoundingClientRect().top` is 70

#### Scenario: Half-width element
- **WHEN** an element with `width: 50%` sits in an 800-pixel-wide container
- **THEN** its `offsetWidth` is 400

### Requirement: Element box properties
`offsetWidth`, `offsetHeight`, `clientWidth` and `clientHeight` SHALL be an element's box size, rounded down to whole pixels, and `getBoundingClientRect()` SHALL return a `DOMRect` of its box. `offsetTop` and `offsetLeft` SHALL be its offset within its containing block.

#### Scenario: Element without CSS sizes
- **WHEN** a page reads `offsetWidth` and `offsetHeight` of a `div` with no CSS sizes, directly in the body
- **THEN** they are 800 and 0

#### Scenario: Element outside the document
- **WHEN** a page measures a `div` with `width: 120px` before inserting it into the document
- **THEN** its `offsetWidth`, `offsetHeight` and `getBoundingClientRect()` size are all 0, as for an element a browser does not render

### Requirement: matchMedia
`window.matchMedia(query)` SHALL return a `MediaQueryList` whose `media` is the query and whose `matches` is `false`, with `addEventListener`, `removeEventListener`, `addListener` and `removeListener` that accept a listener and never call it.

#### Scenario: Wide-gamut check
- **WHEN** an example asks `matchMedia('( color-gamut: p3 )').matches` and listens for its `change` event (cf. three.js `webgl_test_wide_gamut`)
- **THEN** it reads `false` and renders. oxgl reports no `display-p3` support, so the example takes its sRGB path whatever the answer

### Requirement: Platform-limited expectations
The three.js runner SHALL accept an expectations entry that lists, after its expectation, the platforms it applies to (`<example> <OUTCOME> [<platform> ...] # <reason>`), and SHALL use the same platform names and the same rules for applying, judging and updating such entries as conformance expectations (conformance-testing, "Platform-limited expectations" and "Expectations update run"). An entry without a list applies on every platform.

#### Scenario: Tolerance limited to some platforms
- **WHEN** `webgl_shadowmap_viewer` is listed as `DIFF 1% [linux-x64 linux-arm64 windows-x64 windows-arm64]` and differs from its reference in 0.05% of pixels on macOS arm64
- **THEN** a macOS arm64 run judges it as having no entry, so it is expected to `PASS` and passes, while a Linux arm64 run still allows it 1%

#### Scenario: Update on one platform keeps the others' entries
- **WHEN** `webgl_shadowmap_viewer` is listed as `DIFF 1%` with no platforms, it matches within 0.1% on macOS arm64, and the developer runs the update there
- **THEN** the entry becomes `DIFF 1% [linux-x64 linux-arm64 windows-x64 windows-arm64 linux-x64-gles linux-arm64-gles]` with its reason kept, so runs on the other platforms still allow 1%
