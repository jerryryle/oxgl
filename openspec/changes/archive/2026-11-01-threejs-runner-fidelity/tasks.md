# Tasks

## 1. Page environment

- [x] 1.1 Add CSS element boxes to `conformance/window.mjs` (D4). Add tests for "Container between a header and the bottom", "Half-width element" and "Element without CSS sizes", and for a canvas keeping its existing size. Verify with `npm test`, including `test/conformance-harness.test.mjs`.
- [x] 1.2 Add `matchMedia` to the three.js runner (D5), with a test for "Wide-gamut check" using a fixture page. Verify with `npm test`.

## 2. Capture

- [x] 2.1 Read each WebGL canvas with `readPixels` on the default framebuffer (design D1), and composite it by its context's `premultipliedAlpha` (D2). Add tests for both scenarios of "Canvases composited like a browser", using fixture pages that draw a known premultiplied and unpremultiplied pixel. Verify with `npm test`, and that `webgl_materials_blending_custom` drops below 1% of pixels differing.
- [x] 2.2 Capture the viewport with each WebGL canvas at its place (D3), failing for a canvas past the viewport. Add fixture tests for "Side-by-side canvases", "Canvas below a header" and "Canvas past the viewport", replacing the two-canvas and wrong-size tests. Verify with `npm test`.

## 3. Expectations and docs

- [x] 3.1 On Linux arm64 (Docker, per `CLAUDE.md`), run `OXGL_BACKEND=software npm run conformance` and check that both suites pass against unchanged expectations.
- [x] 3.2 On Linux arm64, run `OXGL_BACKEND=software npm run threejs -- --update` and review the expectations diff entry by entry against the images (D6). Give the five formerly unexplained examples their causes. Verify that two further runs without `--update` pass with identical outcomes.
- [x] 3.3 Try to reduce `webxr_xr_dragging` on SwiftShader to a minimal repro (D6), and record the result under "Known upstream issues" in `angle/README.md`. Verify that the entry names the examples and says whether a repro exists.
- [x] 3.4 Update the three.js counts and causes in `README.md` and the runner gaps listed in `CONTRIBUTING.md`, and add the SwiftShader near-plane depth issue to `README.md`'s "Known issues", with subdivision as the workaround, pointing at its `angle/README.md` row. Then run `npm run lint`, `npm test` and `npm run threejs` on Linux arm64, and verify that all pass.

## Workflow follow-up

- Archive `threejs-conformance` before this change, which modifies the `threejs-examples` spec it introduces.
