## ADDED Requirements

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
