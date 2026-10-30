# context-creation Specification

## Purpose
Defines how a caller obtains a headless WebGL 1 or WebGL 2 rendering context from oxgl, how its drawing buffer is allocated and reported, and how the context's native resources are released, by explicit `destroy()` or garbage collection.

## Requirements

### Requirement: createContext entry point
The package SHALL export `createContext(options)` where `options` is `{ width, height, backend?, webgl2?, canvas?, attributes? }`. It SHALL return a `WebGLRenderingContext` when `webgl2` is absent or `false`, and a `WebGL2RenderingContext` when `webgl2` is `true`. No window system, display server, or canvas SHALL be required.

#### Scenario: WebGL 1 context
- **WHEN** `createContext({ width: 64, height: 32 })` is called
- **THEN** it returns a `WebGLRenderingContext` instance with `drawingBufferWidth === 64` and `drawingBufferHeight === 32`

#### Scenario: WebGL 2 context
- **WHEN** `createContext({ width: 64, height: 32, webgl2: true })` is called
- **THEN** it returns a `WebGL2RenderingContext` instance

#### Scenario: Headless host
- **WHEN** `createContext` is called on Linux with no `DISPLAY` or `WAYLAND_DISPLAY` and `backend: 'software'`
- **THEN** a context is returned

### Requirement: Option validation
`createContext` SHALL throw a `TypeError` if `options` is not an object, if `width` or `height` is not a number, if `backend` is present and not one of `'auto'`, `'gpu'`, `'software'`, if `webgl2` is present and not a boolean, or if `canvas` is present and not an object. It SHALL throw a `RangeError` if `width` or `height` is negative, not an integer, or above 2147483647. A width or height of `0` SHALL be accepted.

#### Scenario: Missing dimensions
- **WHEN** `createContext({ width: 10 })` is called
- **THEN** a `TypeError` is thrown and no native resources are allocated

#### Scenario: Non-positive or fractional size
- **WHEN** `createContext({ width: -1, height: 10 })` or `createContext({ width: 1.5, height: 10 })` is called
- **THEN** a `RangeError` is thrown

#### Scenario: Zero size
- **WHEN** `createContext({ width: 0, height: 10 })` is called
- **THEN** a context is returned whose `drawingBufferWidth` is `1` and `drawingBufferHeight` is `10` (cf. Khronos `conformance/canvas/canvas-zero-size.html`)

#### Scenario: Unknown backend
- **WHEN** `createContext({ width: 1, height: 1, backend: 'metal' })` is called
- **THEN** a `TypeError` is thrown whose message lists the accepted values

### Requirement: Drawing buffer size
The drawing buffer SHALL be allocated at the requested size when supported. If the request exceeds implementation limits, a smaller buffer SHALL be allocated as described in WebGL 1.0 §2.2 "The Drawing Buffer", preserving aspect ratio, and `drawingBufferWidth`/`drawingBufferHeight` (WebGL 1.0 §5.14.1) SHALL report the actual size. These attributes SHALL be read-only.

#### Scenario: Requested size honored
- **WHEN** a context is created with `width: 300, height: 150`
- **THEN** `drawingBufferWidth === 300` and `drawingBufferHeight === 150` (cf. Khronos `conformance/canvas/drawingbuffer-test.html`)

#### Scenario: Oversized request is clamped
- **WHEN** a context is created with `width` larger than the implementation's maximum renderbuffer size
- **THEN** creation succeeds, `drawingBufferWidth` is at most that maximum, and the width:height ratio is preserved to within one pixel

#### Scenario: Attributes are read-only
- **WHEN** a caller assigns `gl.drawingBufferWidth = 5`
- **THEN** the value is unchanged (and a `TypeError` is thrown in strict mode)

### Requirement: Drawing buffer format and initial contents
The drawing buffer SHALL have an RGBA8 color buffer when `alpha` is `true` and an RGB8 one without alpha when it is `false`. It SHALL have a depth buffer of at least 16 bits only when `depth` is `true`, and a stencil buffer of at least 8 bits only when `stencil` is `true` (WebGL 1.0 §2.2, §5.2.1). It SHALL initially contain zeros, with depth `1.0`. A headless context is never presented, so its contents SHALL persist until overwritten.

#### Scenario: Initial contents are zero
- **WHEN** `readPixels` reads the whole buffer of a freshly created context
- **THEN** every byte is `0`

#### Scenario: Alpha channel is present
- **WHEN** the buffer is cleared with alpha `0.5` and read back as RGBA/UNSIGNED_BYTE
- **THEN** the alpha byte is `127` or `128`

#### Scenario: No alpha channel
- **WHEN** a context created with `attributes: { alpha: false }` is cleared with alpha `0.5` and read back as RGBA/UNSIGNED_BYTE
- **THEN** the alpha byte is `255`, and `getParameter(ALPHA_BITS)` is `0` (cf. Khronos `conformance/context/context-attributes-alpha-depth-stencil-antialias.html`)

#### Scenario: Depth and stencil on request
- **WHEN** contexts are created with `{ depth: false, stencil: true }`, with `{ depth: true, stencil: true }` and with no attributes, and `getParameter(DEPTH_BITS)` and `getParameter(STENCIL_BITS)` are read on each
- **THEN** they are `0` and at least `8` for the first, at least `16` and at least `8` for the second, and at least `16` and `0` for the third

#### Scenario: Contents persist between calls
- **WHEN** the buffer is cleared, then `readPixels` is called twice with no intervening drawing
- **THEN** both reads return identical data

### Requirement: Context creation failure
If no usable backend can create a context for the requested options, `createContext` SHALL throw an `Error` with `code` `'OXGL_CONTEXT_CREATION_FAILED'` (or the backend-specific code defined by backend-selection) whose message includes the underlying EGL error, and SHALL leave no native resources allocated.

#### Scenario: WebGL 2 unavailable
- **WHEN** the selected backend cannot create an OpenGL ES 3.0 context and `webgl2: true` was requested
- **THEN** an `Error` with `code === 'OXGL_CONTEXT_CREATION_FAILED'` is thrown

### Requirement: Explicit destroy
`destroy()` SHALL synchronously release every native resource owned by the context and set its webgl context lost flag, after which the context SHALL behave as a lost context per the lost-context rules of WebGL 1.0 §5.14 (including `[WebGLHandlesContextLoss]`) and §5.15.2 "The Context Lost Event". Calling `destroy()` again SHALL have no effect. `drawingBufferWidth`/`drawingBufferHeight` SHALL then return `0`, as Chromium does for a context lost through `WEBGL_lose_context`.

#### Scenario: Calls after destroy are inert
- **WHEN** `destroy()` is called and then `clearColor`, `clear`, and `readPixels` are called
- **THEN** none throws, `readPixels` leaves the destination array unmodified, and no native call is made

#### Scenario: getError after destroy
- **WHEN** `getError()` is called twice after `destroy()`
- **THEN** it returns `CONTEXT_LOST_WEBGL` and then `NO_ERROR` (cf. Khronos `conformance/context/context-lost.html`)

#### Scenario: Double destroy
- **WHEN** `destroy()` is called twice
- **THEN** the second call returns without error

#### Scenario: Drawing buffer size after destroy
- **WHEN** a 7×3 context is destroyed and `drawingBufferWidth` and `drawingBufferHeight` are read
- **THEN** both are `0`

### Requirement: Garbage-collected contexts release resources
A context that becomes unreachable without `destroy()` SHALL have its native resources released after garbage collection, on the thread that created it, without requiring further API calls.

Accepted trade-off (allocator noise): a leak only slightly above the soak-test threshold can be absorbed by free memory the allocator holds after a high-water step, and go undetected in that run. Whole-context leaks are far above this margin.

#### Scenario: Dropped contexts are reclaimed
- **WHEN** 1,000 contexts are created one per iteration, each dropped without `destroy()` before the next is created, with garbage collection forced every 100 iterations, and the test then repeatedly forces garbage collection and yields to the event loop until its own `FinalizationRegistry` has seen every context collected (failing after 10 seconds) and until the live-context count is back at its pre-pass value (failing after 10 seconds), then yields 10 more event-loop turns; and this pass runs three times in a row after the warm-up, with resident memory measured after a forced garbage collection before the first pass and after each pass
- **THEN** the live-context count is back at its pre-test value after every pass, and the median of the three per-pass resident-memory increases is within the soak-test threshold, with no further oxgl call needed

### Requirement: No resource growth across context lifecycles
Creating and destroying contexts repeatedly SHALL NOT grow resident memory without bound. After a 50-iteration warm-up, creating and destroying 1,000 contexts of 256×256 SHALL increase resident set size by no more than 32 MiB, measured after a forced garbage collection.

Accepted trade-off (upstream ANGLE): each thread that has used oxgl leaves about 72 bytes of ANGLE thread state behind when it exits.

#### Scenario: Software soak test
- **WHEN** the soak test runs with `backend: 'software'`
- **THEN** RSS growth over the 1,000 measured iterations is at most 32 MiB, and the test fails otherwise, reporting the measured growth

#### Scenario: GPU soak test
- **WHEN** a GPU backend is available and the soak test runs with `backend: 'gpu'`
- **THEN** the same threshold holds

### Requirement: Contexts are independent
Multiple live contexts in one process SHALL have independent drawing buffers, clear colors, and error flags; an operation on one SHALL NOT affect another.

#### Scenario: Interleaved contexts
- **WHEN** context A is cleared to red and context B to blue, in interleaved calls
- **THEN** reading back A yields red and B yields blue, and an error generated on A is not visible via B's `getError()`

### Requirement: WebGL IDL constants
`WebGLRenderingContext` SHALL expose every constant of the WebGL 1.0 IDL's `WebGLRenderingContextBase` mixin (WebGL 1.0 §5.14), and `WebGL2RenderingContext` every constant of that mixin and of `WebGL2RenderingContextBase` (WebGL 2.0 §3.7), with the IDL's values, on the interface object and its prototype as WebIDL §3.7.1 defines. A WebGL 1 context SHALL NOT expose WebGL 2-only constants. The TypeScript declarations SHALL declare each constant with its literal value.

#### Scenario: WebGL 1 constant set
- **WHEN** Khronos `conformance/context/constants-and-properties.html` runs against a WebGL 1 context
- **THEN** every constant check passes and no extra properties are reported

#### Scenario: WebGL 2 constant set
- **WHEN** Khronos `conformance2/context/constants-and-properties-2.html` runs against a WebGL 2 context
- **THEN** every constant check passes and no extra properties are reported

#### Scenario: Constants on the interface object
- **WHEN** `WebGLRenderingContext.POINTS`, `WebGLRenderingContext.COLOR_BUFFER_BIT` and `WebGL2RenderingContext.INVALID_INDEX` are read
- **THEN** they equal `0`, `0x00004000` and `0xFFFFFFFF`, and `WebGL2RenderingContext.TIMEOUT_IGNORED` equals `-1`

#### Scenario: WebIDL property attributes
- **WHEN** `Object.getOwnPropertyDescriptor` is read for `RGBA` on each context class and each class's prototype
- **THEN** each descriptor is a data property with value `0x1908`, `writable: false`, `enumerable: true` and `configurable: false`, and a context instance has no own `RGBA` property

#### Scenario: WebGL 2-only constants absent from WebGL 1
- **WHEN** `WebGLRenderingContext.READ_BUFFER` and `gl.READ_BUFFER` on a WebGL 1 context are read
- **THEN** both are `undefined`, while `WebGL2RenderingContext.READ_BUFFER` equals `0x0C02`

#### Scenario: Conformance helper loads
- **WHEN** a conformance page loads the pinned suite's `js/webgl-test-utils.js`
- **THEN** its load-time `glEnumToString` self-checks, which read `WebGLRenderingContext.RGBA` and `WebGLRenderingContext.POINTS`, complete without throwing

#### Scenario: Declarations
- **WHEN** TypeScript code reads constants from the classes and from contexts returned by `createContext({ width: 1, height: 1 })` (WebGL 1) and `createContext({ width: 1, height: 1, webgl2: true })` (WebGL 2)
- **THEN** `WebGLRenderingContext.RGBA`, the WebGL 1 context's `RGBA` and the WebGL 2 context's `READ_BUFFER` have their literal types, and reading `READ_BUFFER` from `WebGLRenderingContext` or from the WebGL 1 context is a type error

### Requirement: Context attributes option
`attributes`, when present, SHALL be converted as a WebIDL `WebGLContextAttributes` dictionary (WebGL 1.0 §5.2), with the IDL's defaults for absent members. A `powerPreference` that is not `'default'`, `'low-power'` or `'high-performance'` SHALL throw a `TypeError`, and `attributes` that is neither an object, `undefined` nor `null` SHALL throw a `TypeError`.

#### Scenario: Defaults
- **WHEN** `createContext({ width: 4, height: 4 })` is called, then `getContextAttributes()`
- **THEN** `depth`, `alpha`, `antialias` and `premultipliedAlpha` are `true`, `stencil` and `preserveDrawingBuffer` are `false`, and `powerPreference` is `'default'`

#### Scenario: Boolean conversion
- **WHEN** `createContext({ width: 4, height: 4, attributes: { depth: 0, stencil: 'yes' } })` is called
- **THEN** the context is created as if `depth` were `false` and `stencil` `true`

#### Scenario: Invalid power preference
- **WHEN** `createContext({ width: 4, height: 4, attributes: { powerPreference: 'fast' } })` is called
- **THEN** a `TypeError` is thrown and no native resources are allocated

### Requirement: Antialiased drawing buffer
With `antialias: true`, the drawing buffer SHALL be multisampled with 4 samples, or with the implementation's maximum renderbuffer sample count when that is lower, and SHALL be single-sampled when the maximum is 0 (WebGL 1.0 §2.2). On WebGL 2 the maximum is `getParameter(MAX_SAMPLES)`. `getParameter(SAMPLES)` and `getParameter(SAMPLE_BUFFERS)` SHALL report the result. Every read of the drawing buffer, including `readPixels`, SHALL see the resolved single-sample contents.

#### Scenario: Multisampled by default
- **WHEN** a WebGL 1 context and a WebGL 2 context are created with default attributes on the software backend, which supports 4 samples
- **THEN** on both, `getParameter(SAMPLES)` is `4`, `getParameter(SAMPLE_BUFFERS)` is `1`, and `getContextAttributes().antialias` is `true`

#### Scenario: Sample count capped by the WebGL 2 maximum
- **WHEN** a WebGL 2 context is created with default attributes
- **THEN** `getParameter(SAMPLES)` is at most `getParameter(MAX_SAMPLES)`

#### Scenario: Reading an antialiased buffer
- **WHEN** an antialiased context is cleared to `(0, 1, 0, 1)` and read with `readPixels` as RGBA/UNSIGNED_BYTE
- **THEN** every pixel is `[0, 255, 0, 255]` and `getError()` returns `NO_ERROR`

#### Scenario: Antialias off
- **WHEN** a context is created with `attributes: { antialias: false }`
- **THEN** `getParameter(SAMPLES)` is `0` and `getContextAttributes().antialias` is `false`

### Requirement: Drawing buffer is framebuffer 0
Until the framebuffers capability adds `bindFramebuffer`, the drawing buffer SHALL be the bound framebuffer, and every query SHALL describe it as the default framebuffer (WebGL 1.0 §2.2). The framebuffer and renderbuffer bindings SHALL be `null`. Internal allocation and resolving SHALL leave no error for `getError()` to report.

#### Scenario: No visible framebuffer object
- **WHEN** `getParameter(FRAMEBUFFER_BINDING)` and `getParameter(RENDERBUFFER_BINDING)` are read on a new context, and then `getError()`
- **THEN** both are `null` and `getError()` returns `NO_ERROR`

#### Scenario: Errors survive a resolve
- **WHEN** `clear(0x1)` is called on an antialiased context, then `readPixels` reads one pixel into a correctly sized view, then `getError()` is called twice
- **THEN** `getError()` returns `INVALID_VALUE` and then `NO_ERROR`

### Requirement: Default draw and read buffers
On WebGL 2, while the drawing buffer is bound, `getParameter(DRAW_BUFFER0)` and `getParameter(READ_BUFFER)` SHALL be `BACK`, and `DRAW_BUFFER1` up to `MAX_DRAW_BUFFERS` − 1 SHALL be `NONE`, the default framebuffer's initial values (OpenGL ES 3.0 §4.2.1, §4.3.1). Higher indexes SHALL generate `INVALID_ENUM`.

#### Scenario: Default draw and read buffers
- **WHEN** a WebGL 2 context reads `getParameter(DRAW_BUFFER0)`, `getParameter(DRAW_BUFFER1)`, `getParameter(READ_BUFFER)`, `getParameter(DRAW_FRAMEBUFFER_BINDING)` and `getParameter(READ_FRAMEBUFFER_BINDING)`
- **THEN** they are `BACK`, `NONE`, `BACK`, `null` and `null` (cf. Khronos `conformance2/state/gl-get-calls.html`)

#### Scenario: Draw buffer index beyond the maximum
- **WHEN** a WebGL 2 context whose `getParameter(MAX_DRAW_BUFFERS)` is `n` reads `getParameter(DRAW_BUFFER0 + n)`, for `n` below 16
- **THEN** it returns `null` and `getError()` returns `INVALID_ENUM`

### Requirement: Implementation read format of the drawing buffer
`getParameter(IMPLEMENTATION_COLOR_READ_FORMAT)` and `getParameter(IMPLEMENTATION_COLOR_READ_TYPE)` SHALL describe a format and type that `readPixels` accepts from the drawing buffer, as ANGLE reports them for its single-sample color buffer, whether or not it is antialiased, without generating an error (WebGL 1.0 §5.14.12).

Accepted trade-off: for an `alpha: false` buffer ANGLE accepts only `RGBA` reads, so the pair is `RGBA`/`UNSIGNED_BYTE` rather than `RGB`.

#### Scenario: Antialiased context
- **WHEN** an antialiased context with `alpha: false` reads both parameters and then `getError()`
- **THEN** `getError()` returns `NO_ERROR`, and `readPixels` with that pair succeeds

### Requirement: Requests that cannot be met
`depth`, `stencil` and `antialias` set to `true` SHALL be requests that the context MAY be unable to meet (WebGL 1.0 §2.2). When a buffer cannot be allocated, the context SHALL be created without it, and `getContextAttributes()` SHALL report it absent.

#### Scenario: No multisampling available
- **WHEN** a context is created with the default `antialias: true` on a backend whose `MAX_SAMPLES` is 0
- **THEN** creation succeeds, `getContextAttributes().antialias` is `false` and `getParameter(SAMPLES)` is `0`

### Requirement: getContextAttributes
`getContextAttributes()` SHALL return a new `WebGLContextAttributes` object on each call (WebGL 1.0 §5.14.2). Its `alpha`, `depth`, `stencil` and `antialias` SHALL report the drawing buffer actually allocated. `premultipliedAlpha`, `preserveDrawingBuffer`, `powerPreference` and `failIfMajorPerformanceCaveat` SHALL report the requested values. `desynchronized` SHALL be `false`. On a lost or destroyed context it SHALL return `null`.

#### Scenario: Reported values
- **WHEN** a context is created with `attributes: { alpha: false, preserveDrawingBuffer: true }` and `getContextAttributes()` is called
- **THEN** `alpha` is `false`, `preserveDrawingBuffer` is `true`, and changing the returned object does not change a later call's result

#### Scenario: Lost context
- **WHEN** a context is destroyed and `getContextAttributes()` is called
- **THEN** it returns `null`

### Requirement: failIfMajorPerformanceCaveat
When `failIfMajorPerformanceCaveat` is `true`, `createContext` SHALL NOT create the context on the software backend. With backend `'auto'` it SHALL behave as `'gpu'`, throwing `OXGL_GPU_UNAVAILABLE` when no GPU backend can create it. With backend `'software'` it SHALL throw an `Error` with `code` `'OXGL_CONTEXT_CREATION_FAILED'` whose message names the attribute.

#### Scenario: Software refused
- **WHEN** `OXGL_BACKEND=software` and `createContext({ width: 4, height: 4, attributes: { failIfMajorPerformanceCaveat: true } })` is called
- **THEN** an `Error` with `code === 'OXGL_CONTEXT_CREATION_FAILED'` is thrown and no native resources are allocated

### Requirement: canvas attribute
A context's `canvas` attribute (WebGL 1.0 §5.14.1) SHALL return the `canvas` option's object when one was given. Otherwise it SHALL return a `HeadlessCanvas` that oxgl created for the context. The attribute SHALL be read-only and return the same object on every read.

#### Scenario: Caller's canvas
- **WHEN** `createContext({ width: 4, height: 4, canvas: element })` is called
- **THEN** `gl.canvas === element`

#### Scenario: Headless canvas
- **WHEN** a context is created without `canvas`
- **THEN** `gl.canvas` is a `HeadlessCanvas` and an `EventTarget`, with `width` and `height` equal to the requested size

### Requirement: HeadlessCanvas
`HeadlessCanvas` SHALL be exported, SHALL NOT be constructible from JS, and SHALL extend `EventTarget`. Its `width` and `height` SHALL follow the HTML canvas element's reflection rules: a value above 2147483647 after WebIDL `unsigned long` conversion, such as `-1`, stores the default (`300` for width, `150` for height). Setting either SHALL store the value and resize its context's drawing buffer to the canvas's new size. On a lost or destroyed context it SHALL only store the value.

#### Scenario: Resize through the canvas
- **WHEN** `gl.canvas.width = 20` is set on a 4×4 context
- **THEN** `gl.canvas.width` is `20` and `gl.drawingBufferWidth` is `20` (cf. Khronos `conformance/canvas/drawingbuffer-test.html`)

#### Scenario: Out-of-range width
- **WHEN** `gl.canvas.width = -1` is set
- **THEN** `gl.canvas.width` is `300` and `gl.drawingBufferWidth` is `300`

#### Scenario: Canvas of a destroyed context
- **WHEN** a context is destroyed and `gl.canvas.width = 20` is set
- **THEN** no exception is thrown, `gl.canvas.width` is `20`, and `gl.drawingBufferWidth` is still `0`

#### Scenario: Not constructible
- **WHEN** `new HeadlessCanvas()` is evaluated
- **THEN** a `TypeError` is thrown

### Requirement: Drawing buffer resize
A context's non-standard `resize(width, height)` SHALL reallocate its drawing buffer at the new size, clamped as when the context was created, with the contents of a new buffer. All other context state, including the viewport and scissor box, SHALL be kept (WebGL 1.0 §2.2). On a `HeadlessCanvas` context it SHALL also set the canvas's `width` and `height` to the requested, unclamped size. On a lost context it SHALL do nothing.

#### Scenario: Viewport kept on resize
- **WHEN** a 10×20 context is resized to 20×10 and `getParameter(VIEWPORT)` is called
- **THEN** it returns `[0, 0, 10, 20]`, `drawingBufferWidth` is `20`, and every pixel reads back as zero (cf. Khronos `conformance/canvas/viewport-unchanged-upon-resize.html`)

#### Scenario: Resize to the same size clears
- **WHEN** a context cleared to red is resized to its current size
- **THEN** every pixel reads back as zero

#### Scenario: State that affects clearing is kept
- **WHEN** a context sets a red clear color, `colorMask(true, false, false, false)` and an enabled scissor test, and is then resized
- **THEN** every pixel reads back as zero, and the clear color, color mask and scissor test still read back as set

#### Scenario: Invalid size
- **WHEN** `resize(-1, 4)`, `resize(1.5, 4)` or `resize(2147483648, 4)` is called
- **THEN** a `RangeError` is thrown and the drawing buffer is unchanged

#### Scenario: Canvas keeps the requested size
- **WHEN** `max` is `getParameter(MAX_VIEWPORT_DIMS)[0]` and a `HeadlessCanvas` context is resized with `resize(max + 100, 4)`
- **THEN** `gl.canvas.width` is `max + 100` and `gl.drawingBufferWidth` is at most `max`
