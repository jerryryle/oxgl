# Spec Delta

## ADDED Requirements

### Requirement: Shader objects
`createShader`, `shaderSource`, `compileShader`, `getShaderParameter`, `getShaderInfoLog`, `getShaderSource`, `deleteShader` and `isShader` SHALL behave as WebGL 1.0 §5.14.9 specifies, compiling GLSL ES 1.00 on both versions and GLSL ES 3.00 on WebGL 2 under WebGL's shading-language rules (WebGL 1.0 §6, WebGL 2.0 §5). `getShaderSource` SHALL return the last source exactly as given.

#### Scenario: Compile status and log
- **WHEN** a vertex shader with a syntax error is compiled
- **THEN** `getShaderParameter(shader, COMPILE_STATUS)` is `false` and `getShaderInfoLog` is a non-empty string (cf. Khronos `conformance/glsl/misc/shader-with-define-line-continuation.frag.html` and the other `glsl/misc` pages)

#### Scenario: Valid shader
- **WHEN** `void main() { gl_Position = vec4(0.0); }` is compiled as a vertex shader
- **THEN** `COMPILE_STATUS` is `true` and `SHADER_TYPE` is `VERTEX_SHADER`

#### Scenario: Source round trip
- **WHEN** `shaderSource(shader, s)` is called with any string `s`
- **THEN** `getShaderSource(shader)` returns `s`

### Requirement: Program objects
`createProgram`, `attachShader`, `detachShader`, `linkProgram`, `useProgram`, `validateProgram`, `getProgramParameter`, `getProgramInfoLog`, `getAttachedShaders`, `deleteProgram` and `isProgram` SHALL behave as WebGL 1.0 §5.14.9 specifies. `getAttachedShaders` SHALL return the attached shader objects themselves. Using a program that failed to link SHALL generate `INVALID_OPERATION`.

#### Scenario: Link and use
- **WHEN** a valid vertex and fragment shader are attached and linked and the program is made current
- **THEN** `LINK_STATUS` is `true`, `ATTACHED_SHADERS` is `2`, `getAttachedShaders` contains both shaders, and `getParameter(CURRENT_PROGRAM)` returns the program (cf. Khronos `conformance/programs/program-test.html`)

#### Scenario: Link failure
- **WHEN** a program with only a vertex shader is linked
- **THEN** `LINK_STATUS` is `false` and `useProgram` with it generates `INVALID_OPERATION`

### Requirement: Attribute and uniform introspection
`bindAttribLocation`, `getAttribLocation`, `getActiveAttrib`, `getActiveUniform` and `getUniformLocation` SHALL behave as WebGL 1.0 §5.14.10 specifies; on WebGL 2 so SHALL `getFragDataLocation`. `getActiveAttrib`/`getActiveUniform` SHALL return a `WebGLActiveInfo` with `size`, `type` and `name`, or `null` with `INVALID_VALUE` for an index out of range.

#### Scenario: Active uniform
- **WHEN** a linked program declares `uniform vec4 u_color;` used in its fragment shader
- **THEN** `getActiveUniform(program, 0)` has `name` `'u_color'`, `type` `FLOAT_VEC4` and `size` `1` (cf. Khronos `conformance/programs/get-active-test.html`)

#### Scenario: Names over 256 characters
- **WHEN** `getAttribLocation` is called with a 257-character name on WebGL 1
- **THEN** `INVALID_VALUE` is generated (cf. Khronos `conformance/glsl/misc/attrib-location-length-limits.html`)

### Requirement: Uniform values
The `uniform*` and `uniformMatrix*` setters of WebGL 1.0 §5.14.10 and WebGL 2.0 §3.7.8 SHALL set uniform values as specified there. A location from a program that is not current, or from an earlier link of it, SHALL generate `INVALID_OPERATION`, and a `null` location SHALL do nothing. An array whose length is zero or not a multiple of the component count SHALL generate `INVALID_VALUE`. `getUniform` SHALL return the type WebGL 1.0 §5.14.10's table gives.

#### Scenario: Set and get a vector
- **WHEN** `uniform4fv(location, [1, 2, 3, 4])` is called for a `vec4` uniform of the current program
- **THEN** `getUniform(program, location)` returns a `Float32Array` `[1, 2, 3, 4]` (cf. Khronos `conformance/uniforms/gl-uniform-arrays.html`)

#### Scenario: Location of another program
- **WHEN** a location from program A is used while program B is current
- **THEN** `INVALID_OPERATION` is generated (cf. Khronos `conformance/uniforms/uniform-location.html`)

#### Scenario: Location from an earlier link
- **WHEN** a program is relinked and an old location is used with `uniform1f`
- **THEN** `INVALID_OPERATION` is generated

#### Scenario: Bad array length
- **WHEN** `uniform3fv` is called with a 4-element array for a `vec3`
- **THEN** `INVALID_VALUE` is generated

#### Scenario: Boolean and sampler types
- **WHEN** `getUniform` reads a `bool` set with `uniform1i(location, 2)` and a `sampler2D` set to `3`
- **THEN** it returns `true` and `3`
