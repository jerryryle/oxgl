# Tasks

## 1. The canvas package

- [x] 1.1 Add `canvas` `3.2.3` to `devDependencies` in `package.json`, edited in place and keeping the `@fission-ai/openspec` devDependency, and update `package-lock.json` with `npm install`. Verify that `npm ci` installs the prebuilt binary without compiling on macOS arm64 and on Linux arm64 (Docker per `CLAUDE.md`), that `node -e "require('canvas')"` succeeds on both, and that `npm pack --dry-run` lists no `canvas` files.
- [x] 1.2 In `conformance/run.mjs`, resolve and load `canvas` before starting the suite server, and stop with an error naming `canvas` and `npm ci` when it fails. Add a test to `test/conformance-harness.test.mjs` for the "Canvas package missing" scenario, using an injected loader rather than uninstalling the package. Document the dependency and why it exists in `CONTRIBUTING.md`. Verify with `npm test`.

## 2. Runner shim

- [x] 2.1 In `installShim` (`conformance/page.mjs`), keep jsdom's original `getContext`, delegate non-WebGL types to it, and enforce one context type per canvas in both directions with a `WeakSet` (design). Add harness fixture pages and tests for the scenarios "Default canvas size", "Unsupported context type", "2D context" and "One context type per canvas". Verify with `npm test`.
- [x] 2.2 Narrow `failMedia()` to `HTMLMediaElement`, make `play()` reject with `NotSupportedError`, and let images load through jsdom. Add fixture pages and tests for "Texture upload from an image", "Texture upload from a video", "Member oxgl lacks", "Image drawn into a 2D canvas" and "Missing image". Verify with `npm test`.
- [x] 2.3 Replace each window's `postMessage` so messages arrive once, with `source` set to the receiving window and `data` unchanged, after jsdom's `targetOrigin` check (design), and set `window.ImageData` to the `canvas` package's class. Add fixture pages and tests for "Zero-timeout helper" (a local fixture whose helper copies `setZeroTimeout`'s `event.source == window` check, so `npm test` needs no suite download), "Message from a frame", "Mismatched target origin" and "Constructed ImageData". Verify with `npm test` and `npm run lint:js`.

## 3. Conformance results

- [x] 3.1 Rebase `drawing-buffer`'s delta of "Pages obtain oxgl contexts through canvas" (`openspec/changes/drawing-buffer/specs/conformance-testing/spec.md`) on this change's text: keep the 2D context and one-type-per-canvas wording and scenarios, and add its canvas and attributes wording. Verify with `npx openspec validate drawing-buffer --strict`.
- [ ] 3.2 On Linux arm64 (Docker per `CLAUDE.md`, or the `conformance` CI job with a temporary `--update` step), run both suites with `OXGL_BACKEND=software npm run conformance -- --update`, refresh reasons from the reports, and commit `conformance/expectations.txt`. Record in this task:
  - the entry counts before and after;
  - the counts of PASS, FAIL and TIMEOUT per suite, and the run times;
  - the pages whose outcome changed, grouped by directory.

  Verify that no `textures/video` or `context/context-creation*` page times out, and that pages that failed on a null 2D context (`getImageData`, `drawImage`, `fillStyle`) now fail with another reason or pass.
  - Run in a `linux/arm64` Docker container (Node 24, `--jobs 14`), 446 s for both suites.
  - Entries went from 3,099 to 3,095.
  - webgl1: 146 PASS (was 144), 777 FAIL, 48 TIMEOUT. webgl2: 598 PASS (was 595), 2,078 FAIL, 189 TIMEOUT.
  - Changed: `context/context-creation.html` passes (both suites); `rendering/draw-webgl-to-canvas-2d-repeatedly.html` passes (both); `deqp/framework/opengl/simplereference/referencecontext.html` passes; `canvas/canvas-test.html` went from FAIL (null 2D context) to TIMEOUT (both).
  - The `textures/video`, `textures/webgl_canvas` and `conformance2/textures/image` pages still time out, but no longer in the runner: they now reach `tiu.setupTexturedQuad`, whose `gl.createProgram` call throws inside an `async` function. The rejection is ignored, as in a browser, so the page idles until the time limit. They resolve with the shaders and textures work. No page fails on a null 2D context any more.
- [x] 3.3 Run `npx openspec validate harness-2d-canvas --strict`, `npm run lint` and `npm test`, and confirm that all pass.

## Workflow follow-up

- Apply after `context-state` is archived, and before `drawing-buffer`.
- Archive `harness-2d-canvas` and sync its specs once the PR is merged and reviewed.
