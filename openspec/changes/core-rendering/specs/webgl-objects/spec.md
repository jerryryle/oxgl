# Spec Delta

## ADDED Requirements

### Requirement: Object interfaces
oxgl SHALL export `WebGLObject`, `WebGLBuffer`, `WebGLShader`, `WebGLProgram`, `WebGLUniformLocation` and `WebGLActiveInfo` with the IDL's inheritance (WebGL 1.0 §5.3–§5.12). None SHALL be constructible from JS. `WebGLObject.label` SHALL be a stored string, initially empty.

#### Scenario: Not constructible
- **WHEN** `new WebGLBuffer()` is evaluated
- **THEN** a `TypeError` is thrown

#### Scenario: Inheritance
- **WHEN** `gl.createBuffer()` returns `buffer`
- **THEN** `buffer instanceof WebGLBuffer` and `buffer instanceof WebGLObject` are `true`, and `buffer.label` is `''`

### Requirement: Objects belong to their context
Passing an object created by another context to any method SHALL generate `INVALID_OPERATION` and have no other effect (WebGL 1.0 §5.14 "objects from other contexts").

#### Scenario: Buffer from another context
- **WHEN** a buffer created on context A is passed to `bindBuffer` on context B
- **THEN** context B's `getError()` returns `INVALID_OPERATION` and its `ARRAY_BUFFER_BINDING` is unchanged (cf. Khronos `conformance/misc/object-deletion-behaviour.html`)

### Requirement: Wrong object types throw
Passing a value that is not of the IDL's object type (or `null` where nullable) SHALL throw a `TypeError`, as WebIDL conversion does.

#### Scenario: Shader passed as a buffer
- **WHEN** `bindBuffer(ARRAY_BUFFER, gl.createShader(VERTEX_SHADER))` is called
- **THEN** a `TypeError` is thrown

### Requirement: Deleted objects
After `delete*`, an object SHALL report `false` from its `is*` method, deleting it again SHALL do nothing, binding it SHALL generate `INVALID_OPERATION`, and program and shader methods given it SHALL generate `INVALID_VALUE` (WebGL 1.0 §5.14.5, §5.14.9). An object still attached or in use SHALL keep working for rendering until detached or replaced, as in OpenGL ES.

#### Scenario: Deleted buffer
- **WHEN** a buffer is deleted, then `isBuffer`, `bindBuffer` and `deleteBuffer` are called with it
- **THEN** `isBuffer` returns `false`, `bindBuffer` generates `INVALID_OPERATION`, and the second `deleteBuffer` generates nothing (cf. Khronos `conformance/misc/object-deletion-behaviour.html`)

#### Scenario: Deleted program still in use
- **WHEN** the current program is deleted and `drawArrays` is called
- **THEN** the draw renders with that program and `getParameter(CURRENT_PROGRAM)` still returns it

### Requirement: Objects of a lost context
On a lost or destroyed context, `create*` SHALL return `null`, `is*` SHALL return `false`, and every other object method SHALL do nothing and return its IDL default (WebGL 1.0 §5.15.2). Objects created before the loss SHALL stay invalid.

#### Scenario: After destroy
- **WHEN** a context is destroyed and `createBuffer()` and `isBuffer(old)` are called
- **THEN** they return `null` and `false`

### Requirement: Unreferenced objects are released
An object that is neither referenced from JS nor bound or attached in its context SHALL be deleted after garbage collection, on its context's thread, without an explicit `delete*` call. An object that is bound or attached SHALL stay alive while it is.

#### Scenario: Dropped buffers
- **WHEN** 10,000 buffers with 1 KiB of data each are created and dropped and garbage collection is forced
- **THEN** the context's live object count returns to its previous value

#### Scenario: Bound buffer survives collection
- **WHEN** a buffer is bound to `ARRAY_BUFFER` and set up as attribute 0's source, all JS references to it are dropped, garbage collection is forced, and a triangle is drawn
- **THEN** the triangle renders from the buffer's data
