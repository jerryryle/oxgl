# Spec Delta

## Purpose

Covers a WebGL context's fixed-function and pixel-store state: the calls that set it, and the `getParameter`, `isEnabled` and `getShaderPrecisionFormat` queries that read it back (WebGL 1.0 §5.14.3–§5.14.4, WebGL 2.0 §3.7.2).

## ADDED Requirements

### Requirement: State setters
`activeTexture`, `blendColor`, `blendEquation`, `blendEquationSeparate`, `blendFunc`, `blendFuncSeparate`, `clearDepth`, `clearStencil`, `colorMask`, `cullFace`, `depthFunc`, `depthMask`, `depthRange`, `frontFace`, `hint`, `lineWidth`, `polygonOffset`, `sampleCoverage`, `stencilFunc`, `stencilFuncSeparate`, `stencilMask`, `stencilMaskSeparate`, `stencilOp` and `stencilOpSeparate` SHALL behave as WebGL 1.0 §5.14.3 specifies, including its errors and the WebGL-specific rules below.

#### Scenario: Depth clear value
- **WHEN** `clearDepth(0.25)` is called, then `getParameter(DEPTH_CLEAR_VALUE)`
- **THEN** it returns `0.25` and `getError()` returns `NO_ERROR`

#### Scenario: Invalid blend enum
- **WHEN** `blendFunc(0x1234, ONE)` is called
- **THEN** `getError()` returns `INVALID_ENUM` and `getParameter(BLEND_SRC_RGB)` is still `ONE`

#### Scenario: Out-of-range texture unit
- **WHEN** `activeTexture(TEXTURE0 + getParameter(MAX_COMBINED_TEXTURE_IMAGE_UNITS))` is called
- **THEN** `getError()` returns `INVALID_ENUM` and `getParameter(ACTIVE_TEXTURE)` is unchanged

### Requirement: WebGL-specific state rules
The state setters SHALL apply the WebGL 1.0 §6 differences from OpenGL ES that concern them: "Stencil Separate Mask and Reference Value", "Viewport Depth Range" and "Blending With Constant Color".

#### Scenario: Constant color with constant alpha is rejected
- **WHEN** `blendFunc(CONSTANT_COLOR, CONSTANT_ALPHA)` is called
- **THEN** `getError()` returns `INVALID_OPERATION` (cf. Khronos `conformance/misc/webgl-specific.html`)

#### Scenario: Depth range near above far
- **WHEN** `depthRange(1, 0)` is called
- **THEN** `getError()` returns `INVALID_OPERATION` and `getParameter(DEPTH_RANGE)` is still `[0, 1]`

### Requirement: Capabilities enable and disable
`enable(cap)`, `disable(cap)` and `isEnabled(cap)` SHALL accept exactly the capabilities of WebGL 1.0 §5.14.3, plus `RASTERIZER_DISCARD` on WebGL 2 (WebGL 2.0 §3.7.2), and generate `INVALID_ENUM` for any other value, with `isEnabled` then returning `false`.

#### Scenario: Toggle a capability
- **WHEN** `enable(DEPTH_TEST)` is called, then `isEnabled(DEPTH_TEST)`, then `disable(DEPTH_TEST)` and `isEnabled(DEPTH_TEST)`
- **THEN** the results are `true` then `false` and no error is generated

#### Scenario: Desktop-only capability rejected
- **WHEN** `enable(0x0B10)` (`GL_POINT_SMOOTH`) is called
- **THEN** `getError()` returns `INVALID_ENUM` (cf. Khronos `conformance/state/gl-enable-enum-test.html`)

#### Scenario: WebGL 2 capability on WebGL 1
- **WHEN** a WebGL 1 context calls `enable(0x8C89)` (`RASTERIZER_DISCARD`)
- **THEN** `getError()` returns `INVALID_ENUM`, while a WebGL 2 context accepts it

### Requirement: Viewport and scissor
`viewport` and `scissor` SHALL behave as WebGL 1.0 §5.14.4 specifies, generating `INVALID_VALUE` for a negative width or height. A new context's viewport and scissor box SHALL both be `(0, 0, drawingBufferWidth, drawingBufferHeight)`.

#### Scenario: Initial viewport
- **WHEN** a 300×150 context is created and `getParameter(VIEWPORT)` is called
- **THEN** it returns an `Int32Array` `[0, 0, 300, 150]` (cf. Khronos `conformance/canvas/drawingbuffer-test.html`)

#### Scenario: Negative size
- **WHEN** `scissor(0, 0, -1, 4)` is called
- **THEN** `getError()` returns `INVALID_VALUE` and `getParameter(SCISSOR_BOX)` is unchanged

### Requirement: Pixel storage parameters
`pixelStorei(pname, param)` SHALL accept the parameters of WebGL 1.0 §5.14.3 and, on WebGL 2, WebGL 2.0 §3.7.2. It SHALL generate the errors those sections and OpenGL ES 2.0 §3.6.1 (WebGL 2: OpenGL ES 3.0 §3.7.1) specify.

#### Scenario: Invalid alignment
- **WHEN** `pixelStorei(PACK_ALIGNMENT, 3)` is called
- **THEN** `getError()` returns `INVALID_VALUE` and `getParameter(PACK_ALIGNMENT)` is still `4`

#### Scenario: WebGL 2 parameter on WebGL 1
- **WHEN** a WebGL 1 context calls `pixelStorei(0x0D02, 1)` (`PACK_ROW_LENGTH`)
- **THEN** `getError()` returns `INVALID_ENUM`

### Requirement: WebGL-only unpack parameters
`UNPACK_FLIP_Y_WEBGL` and `UNPACK_PREMULTIPLY_ALPHA_WEBGL` SHALL start `false` and store `param != 0`. `UNPACK_COLORSPACE_CONVERSION_WEBGL` SHALL start as `BROWSER_DEFAULT_WEBGL` and accept `NONE` or `BROWSER_DEFAULT_WEBGL` (WebGL 1.0 §5.14.3). That section names no error for any other value, so oxgl SHALL generate `INVALID_VALUE`, as Chromium does.

#### Scenario: WebGL-only unpack parameters are stored
- **WHEN** `getParameter(UNPACK_COLORSPACE_CONVERSION_WEBGL)` is read on a new context, then `pixelStorei(UNPACK_FLIP_Y_WEBGL, 5)` and `pixelStorei(UNPACK_COLORSPACE_CONVERSION_WEBGL, NONE)` are called
- **THEN** the first read returns `BROWSER_DEFAULT_WEBGL`, `getParameter(UNPACK_FLIP_Y_WEBGL)` returns `true`, `getParameter(UNPACK_COLORSPACE_CONVERSION_WEBGL)` returns `NONE`, and no error is generated (cf. Khronos `conformance/misc/webgl-specific.html`)

#### Scenario: Invalid colorspace conversion
- **WHEN** `pixelStorei(UNPACK_COLORSPACE_CONVERSION_WEBGL, 0x1234)` is called
- **THEN** `getError()` returns `INVALID_VALUE` and the stored value is unchanged

### Requirement: getParameter return types
`getParameter(pname)` SHALL return each parameter of the WebGL 1.0 §5.14.3 table, and on WebGL 2 the WebGL 2.0 §3.7.2 table, as the JS type that table gives it: a number, a boolean, an array of booleans, a string, a `Float32Array`, an `Int32Array`, or a `Uint32Array`. Each typed-array result SHALL be a new object. `GLuint` values SHALL be unsigned.

#### Scenario: Typed-array results
- **WHEN** `getParameter(COLOR_CLEAR_VALUE)` and `getParameter(MAX_VIEWPORT_DIMS)` are called
- **THEN** they return a 4-element `Float32Array` and a 2-element `Int32Array`, and a second call returns different objects with equal contents (cf. Khronos `conformance/state/gl-get-calls.html`)

#### Scenario: Boolean array result
- **WHEN** `colorMask(true, false, true, false)` is called, then `getParameter(COLOR_WRITEMASK)`
- **THEN** it returns the array `[true, false, true, false]`

#### Scenario: Unsigned mask
- **WHEN** `getParameter(STENCIL_WRITEMASK)` is called on a new context
- **THEN** it returns a non-negative number whose low 8 bits are all set (cf. Khronos `conformance/state/gl-initial-state.html`)

#### Scenario: WebGL 2 parameters
- **WHEN** a WebGL 2 context calls `getParameter(MAX_3D_TEXTURE_SIZE)` and `getParameter(MAX_ELEMENT_INDEX)`
- **THEN** both return positive numbers (cf. Khronos `conformance2/state/gl-get-calls.html`)

### Requirement: getParameter unknown and unavailable parameters
`getParameter` SHALL generate `INVALID_ENUM` and return `null` for a parameter its context's table does not list, including WebGL 2 parameters on a WebGL 1 context and the parameters of extensions that are not enabled.

#### Scenario: Unknown parameter
- **WHEN** `getParameter(0x1234)` is called
- **THEN** it returns `null` and `getError()` returns `INVALID_ENUM`

#### Scenario: WebGL 2 parameter on WebGL 1
- **WHEN** a WebGL 1 context calls `getParameter(0x8073)` (`MAX_3D_TEXTURE_SIZE`)
- **THEN** it returns `null` and `getError()` returns `INVALID_ENUM` (cf. Khronos `conformance/state/gl-enum-tests.html`)

#### Scenario: Extension parameter without the extension
- **WHEN** `getParameter(0x84FF)` (`MAX_TEXTURE_MAX_ANISOTROPY_EXT`) is called
- **THEN** it returns `null` and `getError()` returns `INVALID_ENUM`

### Requirement: getParameter object bindings
Parameters whose table type is a WebGL object (for example `ARRAY_BUFFER_BINDING`, `CURRENT_PROGRAM`, `TEXTURE_BINDING_2D`, `FRAMEBUFFER_BINDING`, and on WebGL 2 `VERTEX_ARRAY_BINDING` and `SAMPLER_BINDING`) SHALL return the bound object, which is `null` while nothing is bound, and SHALL generate no error.

#### Scenario: Nothing bound
- **WHEN** `getParameter(ARRAY_BUFFER_BINDING)` is called on a new context
- **THEN** it returns `null` and `getError()` returns `NO_ERROR`

### Requirement: getParameter version strings
`getParameter(VERSION)` SHALL return a string beginning `WebGL 1.0` (WebGL 2: `WebGL 2.0`), and `getParameter(SHADING_LANGUAGE_VERSION)` one beginning `WebGL GLSL ES 1.0` (WebGL 2: `WebGL GLSL ES 3.00`), as WebGL 1.0 §5.14.3 and WebGL 2.0 §3.7.2 specify. `VENDOR` and `RENDERER` SHALL return `oxgl`.

#### Scenario: Version prefix
- **WHEN** a WebGL 2 context calls `getParameter(VERSION)` and `getParameter(SHADING_LANGUAGE_VERSION)`
- **THEN** they start with `WebGL 2.0` and `WebGL GLSL ES 3.00` (cf. Khronos `conformance2/state/gl-get-calls.html`)

### Requirement: getShaderPrecisionFormat
`getShaderPrecisionFormat(shadertype, precisiontype)` SHALL behave as WebGL 1.0 §5.14.9 specifies. It SHALL return a new `WebGLShaderPrecisionFormat` (WebGL 1.0 §5.12) with read-only `rangeMin`, `rangeMax` and `precision`, or generate `INVALID_ENUM` and return `null` for an invalid enum. `WebGLShaderPrecisionFormat` SHALL NOT be constructible from JS.

#### Scenario: High float precision
- **WHEN** `getShaderPrecisionFormat(FRAGMENT_SHADER, HIGH_FLOAT)` is called
- **THEN** it returns a `WebGLShaderPrecisionFormat` with `rangeMin >= 62`, `rangeMax >= 62` and `precision >= 16`, or all three `0` (cf. Khronos `conformance/misc/shader-precision-format.html`)

#### Scenario: Invalid shader type
- **WHEN** `getShaderPrecisionFormat(0x1234, HIGH_FLOAT)` is called
- **THEN** it returns `null` and `getError()` returns `INVALID_ENUM`

#### Scenario: Not constructible
- **WHEN** `new WebGLShaderPrecisionFormat()` is evaluated
- **THEN** a `TypeError` is thrown

### Requirement: State methods convert arguments per WebIDL
Each method in this capability SHALL convert its arguments by the WebIDL rules for its IDL types (`GLenum`, `GLint`, `GLuint`, `GLsizei`, `GLfloat`, `GLclampf`, `GLboolean`) before any state changes, and SHALL throw a `TypeError` when called with fewer arguments than the IDL requires.

#### Scenario: Numeric and boolean conversion
- **WHEN** `colorMask(0, 'x', null, {})` is called
- **THEN** it behaves as `colorMask(false, true, false, true)` and no exception is thrown

#### Scenario: Too few arguments
- **WHEN** `viewport(0, 0, 4)` is called
- **THEN** a `TypeError` is thrown and the viewport is unchanged

### Requirement: State methods on a lost context
On a lost or destroyed context, the methods in this capability SHALL follow WebGL 1.0 §5.14 for lost contexts: setters do nothing, `getParameter` and `getShaderPrecisionFormat` return `null`, `isEnabled` returns `false`, and none generates an error or throws, except a `TypeError` for too few arguments.

#### Scenario: Queries after destroy
- **WHEN** a context is destroyed, then `enable(BLEND)`, `getParameter(VIEWPORT)` and `isEnabled(BLEND)` are called
- **THEN** none throws, they return `undefined`, `null` and `false`, and the first `getError()` returns `CONTEXT_LOST_WEBGL` (cf. Khronos `conformance/context/context-lost.html`)
