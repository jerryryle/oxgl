# Design

## Context

See proposal.md for what the investigation found. The relevant current state:

- `threejs/example.mjs` captures through `canvasPixels(canvas)`, oxgl's JS-layer readback, which `toDataURL` and drawing into a 2D canvas also use. It returns the drawing buffer unpremultiplied (`Context::drawing_buffer_rgba8` in oxgl-core), so a premultiplied pixel whose colour exceeds its alpha comes back clamped.
- `threejs/image.mjs`'s `composite` blends that result as straight alpha. For a premultiplied buffer, that applies alpha twice.
- The shared shim in `conformance/window.mjs` already sizes a canvas's `clientWidth` and `clientHeight` from its inline pixel style or its attributes. jsdom gives every other element a size of 0, and has no `matchMedia`.

## Goals / Non-Goals

**Goals:** frames that equal what Chrome shows for the targeted layouts (one full-window canvas, side-by-side canvases, a canvas below a header); the CSS boxes the targeted examples read; expectations that name real causes.

**Non-Goals:** a layout engine, as in the proposal; any change to oxgl's readback API.

## Decisions

### D1. Capture with `readPixels` on the default framebuffer

For each WebGL canvas, the capture takes its context with `getContext` and the same type, which returns the existing context. It binds framebuffer `null` and, on WebGL 2, the `BACK` read buffer and no pixel-pack buffer, sets `PACK_ALIGNMENT` 1 and the WebGL 2 pack row and skip parameters to 0, and reads `RGBA`/`UNSIGNED_BYTE`. The rows come back bottom first and are flipped.

This runs after the released frame, before any present, and is the runner's last use of the page. The drawing buffer is therefore intact without `preserveDrawingBuffer`, and the changed state needs no restoring. oxgl resolves an antialiased buffer before a read (drawing-buffer spec), so `readPixels` returns what would be presented.

*Alternative:* an oxgl API returning the raw drawing buffer. That changes the native layer and its N-API surface for a test runner's sake, while `readPixels` already returns exactly these bytes.

### D2. Composite by the context's `premultipliedAlpha`

`composite(pixels, background, premultiplied)` computes each channel as `min(255, c + bg × (1 − a))` for a premultiplied buffer, and `c × a + bg × (1 − a)` otherwise. The background stays the body's computed colour over white. The flag comes from `getContextAttributes()`. A premultiplied buffer holding colour above alpha is undefined in WebGL; clamping the sum matches what Chrome's compositor showed for `blending_custom`.

### D3. The viewport, with canvases at their places

The capture starts with an 800×500 frame of the body's background, over white. It walks the document's canvases that have WebGL contexts, in document order. Each one's origin is its parent's box origin (D4), and a canvas whose origin matches the previous canvas's starts where that canvas ended, so siblings in flex or inline-block containers line up left to right. Each canvas is composited (D2) onto the frame at its place. A canvas past the 800×500 viewport fails with the sizes and places found.

This places the targeted layouts without flow layout:
- `webgl_reversed_depth_buffer`'s three 264-pixel canvases, in containers that all start at (0, 0), sit at x = 0, 264 and 528, with background in the last 8 columns.
- `webgl_camera_logarithmicdepthbuffer`'s two 400-pixel canvases sit at x = 0 and 400.
- `webgl_postprocessing_fxaa`'s canvas sits at (0, 70) in its absolutely positioned container.

*Alternative:* require canvases to fill one row exactly. `reversed_depth_buffer`'s row is 792 wide, and the fxaa canvas does not start at the top.

### D4. CSS boxes in the shared shim

`conformance/window.mjs` computes an element's box `{ x, y, width, height }` from `window.getComputedStyle`, which applies jsdom's stylesheets:

- **Containing block:** the nearest ancestor with `position` other than `static`, else the viewport. `html` and `body` are the viewport (`innerWidth` × `innerHeight`).
- **Absolute or fixed elements:** `left`, `top`, `right` and `bottom` in `px` or `%` of the containing block give the offsets. An unset `width` is the space between `left` and `right`, an unset `height` the space between `top` and `bottom`.
- **Other elements:** they sit at their containing block's origin. `width` and `height` in `px` or `%` apply; an unset `width` is the containing block's width, and an unset `height` is 0.
- **Canvases:** they keep their existing size rule.

`offsetWidth`, `offsetHeight`, `clientWidth` and `clientHeight` floor the box size; `offsetLeft` and `offsetTop` give the offset within the containing block; and `getBoundingClientRect()` returns a `DOMRect` of the box. All of these are defined on `HTMLElement.prototype`.

This is a fixed-position approximation, not flow layout: siblings in normal flow overlap at their parent's origin, which D3 accounts for with canvases. The shim is shared, so Khronos pages get it too. They do not lay anything out, and the conformance runs in the tasks check that their outcomes do not change.

### D5. `matchMedia` in the three.js runner

`example.mjs` installs it beside its `fetch`, as the Khronos runner has no use for it. It returns a plain object with `media`, `matches: false`, `onchange: null` and no-op listener methods. For `webgl_test_wide_gamut` the answer does not matter: `WebGL.isColorSpaceAvailable(DisplayP3ColorSpace)` is false on oxgl, so the example takes its sRGB path either way. Both answers gave the same frame, 1.9% from the reference.

### D6. Expectations

After D1 to D5, one `--update` run on Linux arm64 rewrites the entries. `--update` never raises a tolerance, so an existing `DIFF` whose example now differs more becomes a `FAIL`; each of those is checked against its images before it is accepted. The five formerly unexplained examples get their causes from proposal.md. `alphahash` is likely to stay above 5% as noise. The `xr_dragging` pair are tried in smaller scenes (shadows off, one geometry at a time) for a minimal SwiftShader repro, recorded in `angle/README.md` whether or not one is found.

## Risks / Trade-offs

- [The CSS sizes change what Khronos pages see] → Full conformance runs before and after, judged against unchanged expectations.
- [The placement rule puts a canvas where Chrome would not, in layouts it does not model] → Such a page mismatches its reference and fails on the image, which shows the cause. Before this change it failed on the canvas size anyway.
- [Re-seeding moves many entries at once] → The update's diff is reviewed entry by entry, and runs twice to confirm the outcomes are stable.
