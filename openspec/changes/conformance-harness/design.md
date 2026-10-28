# Design

## Context

The Khronos suite (`KhronosGroup/WebGL`, `sdk/tests`) is a tree of HTML pages. Each page loads `js/js-test-pre.js` and `js/webgl-test-utils.js` and creates contexts through `canvas.getContext`. It reports through `testPassed` and `testFailed`, then signals completion with `finishTest()`. When `window.parent.webglTestHarness` exists, `js-test-pre.js` forwards each result and the completion signal to it. That is how the official `webgl-conformance-tests.html` collects results from pages it runs in iframes. Test lists (`00_test_list.txt`, nested per directory) select pages, and `--min-version`/`--max-version` filter them by WebGL version. `webgl-test-utils.js` chooses WebGL 2 contexts when the page URL carries `webglVersion=2`.

oxgl today exposes `createContext({ width, height, backend, webgl2 })` and the two context classes, and has no DOM. See proposal.md for motivation and scope.

## Goals / Non-Goals

**Goals:**
- Page outcomes that match what the official harness would report for the same API behaviour, so a passing page means what it means in a browser.
- A full CI run short enough to require on every pull request.
- A runner that is debuggable locally: run one page, see why it failed.

**Non-Goals:**
- A general DOM or canvas implementation. jsdom plus a minimal shim covers what the pages need to reach WebGL calls. Anything else stays unsupported and shows up as failures.
- Making the runner reusable outside this repository.

## Decisions

### jsdom with a canvas shim, not a headless browser

Each page loads in a jsdom window (`runScripts: 'dangerously'`, `resources: 'usable'`, `pretendToBeVisual: true` for `requestAnimationFrame`). Before any page script runs, the runner:
- replaces `HTMLCanvasElement.prototype.getContext` with one that calls oxgl's `createContext` (per spec: context types, one context per canvas, canvas size at first call). If `createContext` throws, for example on a 0×0 canvas, it returns `null` and keeps the message for the page's report entry. A browser's `getContext` never throws, so propagating the error would fail the page for a shim reason;
- evaluates oxgl's JS layer (`dist/context.js`, with the native addon shared with the runner) inside the window's realm and defines its `WebGLRenderingContext` and `WebGL2RenderingContext` on the window. In a browser the WebGL objects and the errors they throw belong to the page's realm, and pages rely on it: `wtu.shouldThrow` checks `e instanceof TypeError`, and `context-type-test.html` walks the prototype chain to `Object.prototype`. Loaded from Node's realm, oxgl's `TypeError` would fail both. The file's one import and its `export` keywords are stripped and the body compiled with `vm.compileFunction` in the window's context; any other import or export is a harness error, so a change to the file's shape cannot go unnoticed. Values the native addon itself creates still come from Node's realm, so the JS layer keeps building the objects pages see;
- defines `window.webglTestHarness`. In a top-level jsdom window `window.parent === window`, so `js-test-pre.js` finds it without changes to the suite;
- installs the same shim in every frame window the page opens, before the frame's document parses. jsdom gives a frame a new window on each navigation through its internal `createWindow` and has no public hook, so the child wraps that function. When jsdom closes a window, as it does for a frame's old document on navigation, the contexts created in that window are destroyed, as a browser releases them with the document; otherwise a page that reloads a frame would keep every earlier load's drawing buffers. The runner holds contexts only weakly, so one a page drops is collected and released by oxgl's own finalizer, as in a browser; pages such as `context-eviction-with-garbage-collection.html` rely on that. Only reports from the page's own document count (js-test-pre.js passes its `location.pathname`): in the official harness a test page's frames have no `webglTestHarness` above them, so a frame's results and `finishTest()` never reach it. For the same reason frames get a console of their own, so a frame's uncaught error neither ends the page early nor becomes its recorded error;
- makes `HTMLImageElement`, `HTMLVideoElement` and `HTMLAudioElement` dispatch `error` on the next task after `src` is set. Without the optional `canvas` package jsdom fires neither `load` nor `error`, so these pages would otherwise sit out the full time limit. The texture-from-image directories alone would make CI take hours.

Alternative: run the pages in a real browser and inject oxgl. That would measure the browser's DOM, not oxgl, and cannot load a Node addon. Alternative: write our own `js-test-pre.js` replacement. That diverges from the suite's own result semantics, and the pin would need re-checking against it on every bump.

The shim never adds members to oxgl objects (spec: "Unsupported media fails promptly"). Anything missing, such as `gl.canvas` or context attributes, shows up in the results, and fixing it belongs to the change that owns that API.

### Serve the suite over loopback HTTP

The parent process serves the suite directory on `127.0.0.1` at an ephemeral port, and pages load from `http://127.0.0.1:<port>/…`. Pages fetch shaders and resources with synchronous and asynchronous XHR, and some open iframes. Same-origin HTTP gives them the semantics they were written for. Alternative: `file:` URLs. jsdom's handling of `file:` XHR and origins differs from browsers, and differences would show up as spurious failures. The server only serves files under the suite root and binds to loopback only.

### One child process per page, fixed pool

The parent parses the test lists, then runs pages through a pool of `max(1, floor(os.availableParallelism() / 2))` workers by default (`--jobs` overrides). SwiftShader runs each context's work on its own thread pool sized to the machine, so one page per core would oversubscribe the CPU. A heavy page would then run several times slower than alone and flip between `PASS` and `TIMEOUT` from run to run. Half the cores keeps contention bounded. Task 5.1 confirms that no passing page goes more than half the time limit without a result at the default pool size, so ordinary load variation cannot push one over. Each page runs in a fresh `child_process.fork` of the page script, which reports its outcome over IPC and exits. The time limit is the official harness's watchdog: a page times out when it goes the limit without a new result (default 20 s, as in `webgl-test-harness.js`; `--timeout` overrides), and each result restarts the clock. A total limit would have to cover the longest pages (deqp pages report for minutes) and would then make every page that stops without an error, such as the `conformance/more` pages whose `unit.js` catches the error and never finishes, wait that long on every run. The child's counts messages are the results' signal: sent from the reporting call itself at most every 250 ms, so the clock restarts within 250 ms of a result even while a page reports inside a long synchronous stretch, which in the official harness cannot trip the watchdog because it shares the page's thread. The report records each page's longest gap between them (`maxGapMs`) and the limit as `idleTimeoutSeconds`, and a timed-out page's message says it went that long without a result. There is no total limit, as in the official harness: a page that never stops reporting is bounded by the CI job's own timeout. The parent kills a page that goes the limit without a result and records `TIMEOUT`. The parent records an outcome only once the child has exited, and classifies the exit as follows:
- killed by the parent after going the time limit without a result: `TIMEOUT`;
- killed by any other signal, or by a native abort (on Windows, exit code 3 or a `0xC…` exception status): `CRASH`, even after the child sent an outcome, because a crash while destroying contexts or tearing down the process is a host-process crash the safety rules always put in scope;
- killed by the parent because it reported its outcome but did not exit within 30 s: `CRASH`. The page completed, so it is not a `TIMEOUT`, and once the outcome arrives the time limit no longer applies, so a page that completes just before it is not cut off while tearing down. A hang while destroying contexts is a defect in oxgl's teardown that should stand out like an abort;
- the child's runner code failed: a harness error. The child wraps its own setup and IPC in a handler that sends a harness-error message, and an exit with a non-zero code and no message is treated the same way, since Node exits that way on an uncaught exception in runner code. A harness error fails the run and never becomes an expectation, so runner bugs cannot pass as oxgl crashes;
- a clean exit: the outcome the child reported. Process startup (~0.3 s) is small next to page run time under SwiftShader. Alternatives: reusing a process for many pages lets one page's state, leaks or crash affect others. `worker_threads` share the process, so a native abort ends the whole run.

At page end the child calls `destroy()` on every context the shim created before exiting. A `destroy()` that throws is recorded with the page's context messages and does not change the outcome. The child ignores unhandled promise rejections: they are page-realm rejections, which Node's default would turn into a process exit, while browsers and the official harness ignore them. This keeps the page's own resource use bounded. Process exit would release them anyway.

### Outcome rules follow the official harness

`PASS` needs completion, at least one result, and no failures (spec: "Page outcome"). A page that reports nothing is `FAIL`. At the pinned commit the official harness (`webgl-conformance-tests.html`) colours a completed no-result page as passing (0 of 0), but its run summary does not count it as passed, so `FAIL` matches the summary. Any page that completes through `finishTest()` reports at least one result anyway, because `js-test-post.js` checks `successfullyParsed`.

The official harness installs no `onerror` handler. An escaped error only stops the script that threw it: a page whose main script dies never calls `finishTest()` and times out, while a page whose error came from a side callback can still complete and pass. Matching that for every page would make each page that throws wait out the time limit. Most pages today throw on the first unimplemented call, so a full run would take days. The runner therefore decides per page, using the expectations it has already read:
- A page whose expectation is `FAIL` ends at the first `window.onerror`, with `FAIL` and the error message. It is already known to fail, so ending it early costs no information that the expectations rely on.
- Every other page records the first error and keeps running, as in the official harness, until it completes or reaches the time limit.

The parent passes each page's expected outcome to its child. No other state is involved, and as entries are removed more pages get official semantics, until an empty expectations file means official semantics everywhere. `--fast-errors` makes every page end early, for the first generating run (task 5.1), when the file is still empty, and for local exploration of an unimplemented area. Rule precedence follows the spec: `CRASH`, early-ended error, `TIMEOUT`, then the reported results. The first failure message and the first escaped error are kept for the report and for generated expectation reasons. A generated reason prefers the escaped error, which is the cause: under official semantics a page whose main script threw usually still completes, failing on `successfullyParsed` in `js-test-post.js`, and that message says nothing about what broke. A `TIMEOUT` reason carries the error too.

### Pinning by git commit

`conformance/suite.json` holds the commit SHA and the two version strings that select the 1.0.x and 2.0.x lists. The fetch is a blobless, sparse, depth-1 `git fetch` of that SHA into `.cache/conformance/<sha>/` (gitignored), limited to `sdk/tests`. The commit hash is the integrity check, so there is no separate digest to maintain, unlike the ANGLE bundle, which is a built artifact. There is no override pointing at another checkout: the cache already avoids refetching, and an override would let a run use tests other than the pinned ones, which the spec forbids. Someone working on the suite itself bumps the pin. Alternative: GitHub archive tarballs with a recorded digest. That needs a digest per bump and downloads all of the repository's resources.

### Expectations file

`conformance/expectations.txt` has one line per entry: `<suite> <path> <OUTCOME> # <reason>`. Blank lines and `#` comment lines are allowed. Entries are sorted by suite and path so diffs stay small. Parsing errors, entries without reasons and duplicates fail the run before execution. Entries naming pages a suite lacks fail it afterwards, but only on runs without `--filter` and only for the suites that ran. `SKIP` pages run with `--include-skipped` are reported but never judged. `--update` writes the file back in the same order and keeps existing reasons where the outcome is unchanged. Generated reasons come from failure messages, which can span lines (shader info logs, stack traces). They are reduced to the first non-empty line, with whitespace collapsed and the text cut to 200 characters, so every entry stays on one line. `--update` also leaves `SKIP` entries as they are. On a run without `--filter` it drops entries naming pages that the suites that ran no longer contain, so updating after a pin bump needs no hand edits. Moving a page from `TIMEOUT` to `SKIP` is a manual edit. An `--update` run is judged against the file it writes, so it exits zero whenever it can write that file. Otherwise it would fail on exactly the differences it just recorded.

Per-page judgement, not per-assertion: the spec's out-of-scope note. Partial progress inside a page is visible in the report's counts but does not gate.

### Command shape

`npm run conformance -- [--suite webgl1|webgl2] [--filter <substring>] [--include-skipped] [--fast-errors] [--update] [--timeout <s>] [--jobs <n>]`. `--filter` matches a plain substring of the page path, as the spec says, not a glob. The report records the requested backend: the resolved `OXGL_BACKEND` value, or `auto` when it is unset. oxgl has no API that reports which backend an `auto` context received, and adding one only for the report is not worth it. CI always sets the backend explicitly. It runs against `dist/` and requires `npm run build` first. The report goes to `conformance-results.json` at the repository root (gitignored). It records the time limit and `--jobs` value, since both affect which pages time out. The console prints one line per unexpected outcome and a summary per suite.

### CI job

A `conformance` job in `ci.yml` on `ubuntu-24.04-arm` (Linux arm64, the only supported platform during the Linux arm64 focus), run as a matrix over `suite: [webgl1, webgl2]` so the two suites run in parallel. Steps: build as in `check`, restore `.cache/conformance` keyed by `hashFiles('conformance/suite.json')`, run with `OXGL_BACKEND=software`, and upload the report with `actions/upload-artifact` pinned by SHA under `if: always()`, as `conformance-results-${{ matrix.suite }}`. Artifact names must be unique within a workflow run, so a shared name would make the second upload fail. Both matrix entries are added to the aggregate `ci` job's `needs`.

### Safety rules

The change adds no Rust code and calls oxgl only through its public JS API, so unsafe confinement, the no-panic rule and the handle model are untouched. ArrayBuffer lifetime is exercised, not changed: pages pass views to `readPixels` exactly as applications do. The runner's own tests add coverage of oxgl's crash-free guarantee: a native crash in any page is reported as `CRASH` instead of disappearing, and `CRASH` is never an acceptable steady state (see Risks).

## Risks / Trade-offs

- [jsdom executes suite JavaScript with access to Node.] → Only the pinned Khronos commit is ever run. Pages are served from loopback, and CI jobs have read-only permissions and no secrets.
- [jsdom DOM gaps cause failures unrelated to WebGL.] → They appear in the expectations with their error message as reason, and are distinguishable from WebGL failures by message. If a gap blocks many WebGL-relevant pages, the shim can add a narrow polyfill for that DOM feature. It never patches oxgl objects.
- [Run time under SwiftShader is unknown until the first full run.] → The two suites run as parallel jobs. Pages that time out are converted to `SKIP` with a reason once confirmed to hang. The first full run's duration is recorded in tasks so the job can be split further if needed.
- [A page listed as `FAIL` whose only problem is an escaped error in a side callback would pass in the official harness, but here it ends early and stays `FAIL`.] → Accepted. Its reason is the error message, so a message unrelated to WebGL stands out in the file, and the page gets official semantics once its entry is removed.
- [A step that reports nothing for longer than the limit, such as a long shader compile under SwiftShader, times out though it would finish.] → The official harness has the same limit. Task 5.1 measures the longest gap in passing pages; the limit or the pool size changes if a page comes within half of it.
- [A change that breaks many passing pages makes each of them run to the time limit, so the failing CI run takes longer.] → Accepted. The run fails either way, and the first pages to finish name the regression.
- [Pass/fail counts reach the parent at most every 250 ms, so a page that crashes or times out is reported without the results of its last quarter second.] → Accepted. The counts are for visibility and never gate; streaming every result would cost an IPC message each for pages with millions of results.
- [The frame shim wraps jsdom's internal `createWindow`, which is not public API.] → jsdom is pinned, and the child fails every page as a harness error if the function is missing, so an upgrade that changes it cannot pass silently.
- [A page whose outcome varies between runs fails CI at random.] → No flake tolerance is built in. A flaky page is a bug in oxgl or the runner: fix it, or mark it `SKIP` with the reason while it is being fixed.
- [`CRASH` entries could normalise native crashes.] → A crash of the host process violates the safety rules. The expectations file may list `CRASH` only so the job can land, and each such entry's reason names the follow-up that fixes it.
- [SwiftShader results on any host other than Linux arm64 (macOS, Windows, or Linux x64, where SwiftShader compiles shaders with Subzero instead of LLVM) can differ, so a local run there can disagree with CI.] → Accepted. CI on Linux arm64 is authoritative, and the report records the platform. Per-platform expectations can be added if the other platforms join CI.

## Migration Plan

1. Land the runner and its own tests with an empty expectations file. The CI job is not yet added.
2. Run the full suites once on Linux arm64, generate the expectations with `--update --fast-errors`, and review the reasons: group obvious cases and convert confirmed hangs to `SKIP`.
3. Add the CI job and make it required in `ci`.

Rollback: remove the job from `ci`'s `needs`. Nothing else depends on the harness.

## Open Questions

- Exact version strings for the two lists at the pinned commit (the 1.0.x and 2.0.x values the top-of-tree harness uses). These are read off the pinned commit during implementation and do not change the design.
