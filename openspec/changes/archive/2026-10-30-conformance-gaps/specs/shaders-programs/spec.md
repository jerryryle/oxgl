# Spec Delta

## ADDED Requirements

### Requirement: Deleted shaders and programs in use
A shader deleted while attached to a program SHALL remain a shader object until detached or until its programs are deleted, and a program deleted while current SHALL remain a program object until it is no longer current (OpenGL ES 2.0 §2.10.1, §2.10.3): `isShader`/`isProgram` SHALL return `true` and `DELETE_STATUS` SHALL be `true` meanwhile.

#### Scenario: Deleted attached shader
- **WHEN** a shader attached to a program is deleted, then detached
- **THEN** `isShader` is `true` with `DELETE_STATUS` `true` before the detach and `false` after (cf. Khronos `conformance/programs/program-test.html`, deqp `lifetime`)

### Requirement: Locations need a linked program
`getAttribLocation`, `getUniformLocation` and `getFragDataLocation` SHALL generate `INVALID_OPERATION` and return `-1` or `null` for a program that is not successfully linked, whatever the name.

#### Scenario: Unlinked program
- **WHEN** `getAttribLocation(program, 'gl_x')` is called on a program never linked
- **THEN** it returns `-1` with `INVALID_OPERATION` (cf. Khronos `conformance/attribs/gl-get-attrib-location-errors.html`)
