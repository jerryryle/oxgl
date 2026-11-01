# Proposal

## Why

The three.js runner (threejs-conformance) marks 5 examples as unexplained and 9 as runner gaps that hide real WebGL features. Investigation found that none of the 5 unexplained differences is an oxgl defect:

- **`webgl_materials_blending_custom` and `webgl_materials_alphahash` are runner bugs.** three.js r186 always creates its context with `alpha: true, premultipliedAlpha: true` (its `alpha` option only sets the clear alpha), so blending leaves alpha below 1 in the drawing buffer. A browser shows such a canvas as premultiplied: `rgb + background × (1 − a)`. The runner reads the buffer unpremultiplied, the way `toDataURL` does, which clamps any channel above alpha, and then multiplies by alpha again, darkening every partly transparent pixel. A browser-equivalent composite brings `blending_custom` from 15.9% to 0.26% of pixels differing, and `alphahash` from 11.8% to 5.9%; what remains of `alphahash` is the per-pixel noise of hashed alpha under TAA jitter. The same bug may be inflating other `DIFF` entries.
- **`webgl_materials_physical_transmission_alpha` is a runner gap.** Its coloured panels are an HTML `<table>` behind a transparent canvas, which the runner cannot render.
- **`webxr_xr_dragging` and `webxr_xr_dragging_custom_depth` are SwiftShader-only.** They match the reference exactly on ANGLE Metal and raise no GL errors on SwiftShader, which still drops several objects and all shadows.

Of the runner gaps, five examples are cheap to close. Two size their renderer from a container positioned below a header. Two draw side-by-side canvases. One only needs `matchMedia`.

## What Changes

- **Captures composite like a browser.** The capture reads each WebGL canvas's raw drawing buffer with `readPixels`, not the unpremultiplied copy. It composites a premultiplied buffer as `rgb + background × (1 − a)` and an unpremultiplied one as `rgb × a + background × (1 − a)`.
- **The capture is the whole viewport.** The capture starts from the body's background and composites each WebGL canvas at its place:
  - its parent's box origin;
  - canvases sharing an origin sit side by side in document order, as in a flex or inline row.

  This covers `webgl_reversed_depth_buffer` (three 264-pixel canvases, with 8 pixels of background after them), `webgl_camera_logarithmicdepthbuffer` (two 400-pixel canvases), and the two canvases below a 70-pixel header. A canvas past the viewport fails with a message.
- **Element boxes from CSS.** Element sizes and offsets come from CSS lengths in pixels or percent: `width`, `height`, and `top`, `right`, `bottom` and `left` for absolutely positioned elements. They resolve against the containing block, which is the viewport for `html`, `body` and unpositioned ancestors. These boxes give `offsetWidth`, `offsetHeight`, `clientWidth`, `clientHeight`, `offsetTop`, `offsetLeft` and `getBoundingClientRect()`. This covers `webgl_multisampled_renderbuffers` and `webgl_postprocessing_fxaa`, whose container is `position: absolute; top: 70px; bottom: 0`.
- **`matchMedia`.** It returns a `MediaQueryList` that matches no query and accepts listeners. `webgl_test_wide_gamut` then renders. Its frame is the same with either answer, because oxgl reports no `display-p3` support; it differs from the reference by 1.9% of pixels.
- **Expectations re-seeded and re-triaged on Linux arm64.** The capture change can move every image comparison. The five unexplained entries get their causes. The SwiftShader difference is reduced to a repro, if one can be found, and recorded under "Known upstream issues" in `angle/README.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities
- `threejs-examples`: the captured frame is the viewport, with each canvas composited like a browser at its place; examples get CSS element boxes and `matchMedia`.

This change modifies `threejs-examples`, which `threejs-conformance` introduces, so it archives after that change.

## Impact

- `threejs/example.mjs` and `threejs/image.mjs` (capture, placement and compositing, `matchMedia`); the shared `conformance/window.mjs` (CSS element boxes, available to the Khronos runner too, whose pages do not depend on layout); tests and fixtures under `test/`; `threejs/expectations.txt`; `angle/README.md`; `README.md` (counts, and the SwiftShader near-plane depth issue under "Known issues", which affects any user of the software backend).
- oxgl itself does not change.

## Out of Scope and Extension Points

Each of these is left out because the runner work it needs is large for what it covers. Each could be added later as its own change.

- **`webgl_multiple_elements`, `webgl_multiple_elements_text` and `webgl_loader_texture_ktx2`** draw many small views into one canvas at positions taken from `getBoundingClientRect()` of grid or flex items. Matching the reference needs a CSS flow-layout engine, which jsdom does not have.
- **`webgl_worker_offscreencanvas`** needs module workers (`new Worker(url, { type: 'module' })`), transferring an `OffscreenCanvas` to another thread, and capturing a page canvas next to the placeholder. oxgl contexts belong to their thread, so the worker would render into its own context and send each frame back to the placeholder. That is a new cross-thread mechanism, built for one example.
- **HTML content around the canvas** (`physical_transmission_alpha`'s table, overlays, CSS3D) needs HTML rendering.
- **Examples three.js's own test skips** stay `SKIP`.
- **Fixing the SwiftShader difference** belongs upstream, in ANGLE or SwiftShader, through the oxgl-angle recipe.
