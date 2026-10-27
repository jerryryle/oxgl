# Spec Delta

## Purpose

Covers WebGL operations that write to the drawing buffer. This change introduces `clearColor` and `clear`; draw calls and other drawing-state operations extend this capability later.

## ADDED Requirements

### Requirement: clearColor
`clearColor(red, green, blue, alpha)` SHALL behave as specified in WebGL 1.0 §5.14.3 "Setting and getting state" (OpenGL ES 2.0 §4.2.3 for WebGL 1, OpenGL ES 3.0 §4.2.3 for WebGL 2). Arguments SHALL be converted per WebIDL `GLclampf`/`GLfloat` rules, and fewer than four arguments SHALL throw a `TypeError`.

#### Scenario: Clear color applied
- **WHEN** `clearColor(1, 0, 0, 1)` then `clear(COLOR_BUFFER_BIT)` are called
- **THEN** reading any pixel as RGBA/UNSIGNED_BYTE yields `[255, 0, 0, 255]`

#### Scenario: Out-of-range values are clamped for the default framebuffer
- **WHEN** `clearColor(2, -1, 0.5, 1)` then `clear(COLOR_BUFFER_BIT)` are called
- **THEN** pixels read back as red `255`, green `0`, blue `127` or `128`, alpha `255`

#### Scenario: WebIDL conversion
- **WHEN** `clearColor('1', null, undefined, true)` is called
- **THEN** it behaves as `clearColor(1, 0, NaN, 1)` per WebIDL numeric conversion, and no exception is thrown

#### Scenario: Too few arguments
- **WHEN** `clearColor(1, 0, 0)` is called
- **THEN** a `TypeError` is thrown and the clear color is unchanged

### Requirement: clear
`clear(mask)` SHALL behave as specified in WebGL 1.0 §5.14.11 "Draw Operations" and OpenGL ES 2.0 §4.2.3 (WebGL 2: OpenGL ES 3.0 §4.2.3), including generating `INVALID_VALUE` for bits other than `COLOR_BUFFER_BIT`, `DEPTH_BUFFER_BIT`, and `STENCIL_BUFFER_BIT`. Clearing a buffer the drawing buffer lacks SHALL have no effect on it and generate no error.

#### Scenario: Color clear
- **WHEN** `clear(COLOR_BUFFER_BIT)` is called after setting a clear color
- **THEN** every pixel of the drawing buffer has that color (cf. Khronos `conformance/rendering/gl-clear.html`)

#### Scenario: Invalid mask bits
- **WHEN** `clear(0x1)` is called
- **THEN** `getError()` returns `INVALID_VALUE` and the drawing buffer is unchanged

#### Scenario: Combined mask
- **WHEN** `clear(COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT | STENCIL_BUFFER_BIT)` is called on a buffer without stencil
- **THEN** the color is cleared and `getError()` returns `NO_ERROR`

### Requirement: Constants for drawing members
The context instances and their constructors SHALL expose, with WebGL IDL values, the constants `COLOR_BUFFER_BIT`, `DEPTH_BUFFER_BIT`, and `STENCIL_BUFFER_BIT` (WebGL 1.0 §5.14).

#### Scenario: Constant values
- **WHEN** `gl.COLOR_BUFFER_BIT` and `WebGLRenderingContext.COLOR_BUFFER_BIT` are read
- **THEN** both equal `0x00004000` (cf. Khronos `conformance/context/constants-and-properties.html`)
