# Spec Delta

## MODIFIED Requirements

### Requirement: The captured frame
The captured frame SHALL be the viewport after the released animation frame: the body's background, with each WebGL canvas composited onto it (Canvases composited like a browser) at its place (Canvas placement), halved to 400×250 by averaging 2×2 blocks, as upstream scales its screenshots. A document with no WebGL canvas, or with a canvas that extends past the 800×500 viewport, SHALL produce `FAIL`.

#### Scenario: Example with a single full-window renderer
- **WHEN** an example renders a red cube on black into one 800×500 canvas
- **THEN** the captured frame is 400×250 and shows the cube where Chrome shows it

#### Scenario: Canvas past the viewport
- **WHEN** an example's canvases are 800×500 each, side by side
- **THEN** its outcome is `FAIL` with a message giving the canvas sizes and places found

## ADDED Requirements

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
