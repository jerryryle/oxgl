# context-creation Specification

## Purpose
Defines how a caller obtains a headless WebGL 1 or WebGL 2 rendering context from oxgl, how its drawing buffer is allocated and reported, and how the context's native resources are released, by explicit `destroy()` or garbage collection.

## Requirements

### Requirement: createContext entry point
The package SHALL export `createContext(options)` where `options` is `{ width, height, backend?, webgl2? }`. It SHALL return a `WebGLRenderingContext` when `webgl2` is absent or `false`, and a `WebGL2RenderingContext` when `webgl2` is `true`. No window system, display server, or canvas SHALL be required.

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
`createContext` SHALL throw a `TypeError` if `options` is not an object, if `width` or `height` is not a number, if `backend` is present and not one of `'auto'`, `'gpu'`, `'software'`, or if `webgl2` is present and not a boolean. It SHALL throw a `RangeError` if `width` or `height` is not a positive integer.

#### Scenario: Missing dimensions
- **WHEN** `createContext({ width: 10 })` is called
- **THEN** a `TypeError` is thrown and no native resources are allocated

#### Scenario: Non-positive or fractional size
- **WHEN** `createContext({ width: 0, height: 10 })` or `createContext({ width: 1.5, height: 10 })` is called
- **THEN** a `RangeError` is thrown

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
The drawing buffer SHALL behave as one created with the WebGL default context attributes (WebGL 1.0 §5.2) except that `antialias` is `false`: an RGBA8 color buffer with alpha and a depth buffer, no stencil buffer. It SHALL initially contain transparent black (WebGL 1.0 §2.2). Because a headless context is never presented, its contents SHALL persist until overwritten.

#### Scenario: Initial contents are zero
- **WHEN** `readPixels` reads the whole buffer of a freshly created context
- **THEN** every byte is `0`

#### Scenario: Alpha channel is present
- **WHEN** the buffer is cleared with alpha `0.5` and read back as RGBA/UNSIGNED_BYTE
- **THEN** the alpha byte is `127` or `128`

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
