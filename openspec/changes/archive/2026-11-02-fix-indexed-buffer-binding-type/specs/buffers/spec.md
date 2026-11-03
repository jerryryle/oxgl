## ADDED Requirements

### Requirement: Rejected binds leave a buffer untyped
A never-bound buffer SHALL take its WebGL type (WebGL 2.0 §5.1) only from a bind that takes effect. A `bindBufferBase` or `bindBufferRange` call that generates an error SHALL leave the buffer untyped, so it can still be bound to any target, and `isBuffer` SHALL stay `false` for it.

#### Scenario: Empty bindBufferRange
- **WHEN** a WebGL 2 context calls `bindBufferRange(UNIFORM_BUFFER, 0, buffer, 0, 0)` with a never-bound buffer
- **THEN** `INVALID_VALUE` is generated (OpenGL ES 3.0 §2.10.1.1), `isBuffer(buffer)` is `false`, and a following `bindBuffer(ELEMENT_ARRAY_BUFFER, buffer)` generates no error

#### Scenario: Misaligned bindBufferRange
- **WHEN** a WebGL 2 context whose `UNIFORM_BUFFER_OFFSET_ALIGNMENT` is above 1 calls `bindBufferRange(UNIFORM_BUFFER, 0, buffer, alignment / 2, 16)` with a never-bound buffer
- **THEN** `INVALID_VALUE` is generated, `isBuffer(buffer)` is `false`, and a following `bindBuffer(ELEMENT_ARRAY_BUFFER, buffer)` generates no error

#### Scenario: Out-of-range index
- **WHEN** a WebGL 2 context calls `bindBufferBase(UNIFORM_BUFFER, MAX_UNIFORM_BUFFER_BINDINGS, buffer)` with a never-bound buffer
- **THEN** `INVALID_VALUE` is generated, `isBuffer(buffer)` is `false`, and a following `bindBuffer(ELEMENT_ARRAY_BUFFER, buffer)` generates no error

#### Scenario: Accepted bind still types the buffer
- **WHEN** a WebGL 2 context calls `bindBufferBase(UNIFORM_BUFFER, 0, buffer)` with a never-bound buffer, then `bindBuffer(ELEMENT_ARRAY_BUFFER, buffer)`
- **THEN** the first call generates no error, `isBuffer(buffer)` is `true`, and the second generates `INVALID_OPERATION`

### Requirement: Rejected indexed binds keep the bindings
A `bindBufferBase` or `bindBufferRange` call that generates an error SHALL leave both the indexed binding and the generic binding of its target unchanged, as `getIndexedParameter` and `getParameter` report them (OpenGL ES 3.0 §2.5). This holds when the buffer is already bound at that index.

#### Scenario: Rejected rebind of the buffer at that index
- **WHEN** a WebGL 2 context calls `bindBufferBase(UNIFORM_BUFFER, 0, x)`, then `bindBuffer(UNIFORM_BUFFER, y)`, then `bindBufferRange(UNIFORM_BUFFER, 0, x, 0, 0)`
- **THEN** the last call generates `INVALID_VALUE`, `getParameter(UNIFORM_BUFFER_BINDING)` is still `y`, and `getIndexedParameter(UNIFORM_BUFFER_BINDING, 0)` is still `x`
