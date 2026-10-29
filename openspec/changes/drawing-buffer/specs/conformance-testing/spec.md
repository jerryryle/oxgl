# Spec Delta

## MODIFIED Requirements

### Requirement: Pages obtain oxgl contexts through canvas
Within a page, `getContext` on a canvas element SHALL return an oxgl context for `'webgl'` and `'experimental-webgl'` (WebGL 1) and `'webgl2'` (WebGL 2). The context SHALL be created with the canvas's `width` and `height`, the attributes passed to `getContext`, and the element as its `canvas`. Later calls on that canvas SHALL return the same context, and other context types SHALL get `null`. The page's global scope SHALL expose oxgl's `WebGLRenderingContext` and `WebGL2RenderingContext`.

#### Scenario: Default canvas size
- **WHEN** a page calls `getContext('webgl')` on a canvas with no size attributes
- **THEN** it receives an oxgl `WebGLRenderingContext` with a 300×150 drawing buffer (cf. Khronos `conformance/canvas/drawingbuffer-test.html`)

#### Scenario: Context belongs to its canvas
- **WHEN** a page calls `canvas.getContext('webgl', { alpha: false })`
- **THEN** `gl.canvas === canvas` and `gl.getContextAttributes().alpha` is `false`

#### Scenario: Unsupported context type
- **WHEN** a page calls `getContext('2d')`
- **THEN** it receives `null`, and a page that needs a 2D context fails rather than the runner crashing

### Requirement: Rejected context creation returns null
When oxgl rejects a context creation requested through `getContext`, `getContext` SHALL return `null`, as a browser does when creation fails, and the rejection message SHALL be recorded with the page's results.

#### Scenario: Creation rejected by oxgl
- **WHEN** a page running on the software backend calls `getContext('webgl', { failIfMajorPerformanceCaveat: true })` and oxgl's `createContext` throws
- **THEN** `getContext` returns `null` instead of throwing, and the report's entry for the page includes oxgl's error message

## ADDED Requirements

### Requirement: Canvas resizes reach the drawing buffer
When a page changes the `width` or `height` of a canvas that has an oxgl context, through the property or the content attribute, the context's drawing buffer SHALL be resized to the canvas's new size before that call returns, as a browser does (WebGL 1.0 §2.2).

#### Scenario: Page resizes its canvas
- **WHEN** a page sets `canvas.width = 20` on a canvas with a WebGL context
- **THEN** `gl.drawingBufferWidth` is `20` (cf. Khronos `conformance/canvas/drawingbuffer-test.html`)

#### Scenario: Page resizes through the attribute
- **WHEN** a page calls `canvas.setAttribute('height', '30')` and then `canvas.removeAttribute('width')` on a canvas with a WebGL context
- **THEN** `gl.drawingBufferHeight` is `30` right after the first call, and `gl.drawingBufferWidth` is `300` right after the second
