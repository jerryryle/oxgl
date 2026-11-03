# buffers Specification

## Purpose
Covers WebGL buffer objects: creating and binding them, their data, and the queries and copies on them (WebGL 1.0 §5.14.5, WebGL 2.0 §3.7.3).

## Requirements

### Requirement: Buffer objects
`createBuffer`, `bindBuffer`, `deleteBuffer` and `isBuffer` SHALL behave as WebGL 1.0 §5.14.5 specifies, with the targets of WebGL 1.0 (`ARRAY_BUFFER`, `ELEMENT_ARRAY_BUFFER`) and, on WebGL 2, those of WebGL 2.0 §3.7.3. Binding `null` SHALL unbind. An unknown target SHALL generate `INVALID_ENUM`.

#### Scenario: Bind and query
- **WHEN** a buffer is bound to `ARRAY_BUFFER`
- **THEN** `getParameter(ARRAY_BUFFER_BINDING)` returns that same object and `isBuffer` returns `true` (cf. Khronos `conformance/buffers/buffer-bind-test.html`)

#### Scenario: WebGL 2 target on WebGL 1
- **WHEN** a WebGL 1 context binds a buffer to `COPY_READ_BUFFER`
- **THEN** `INVALID_ENUM` is generated

### Requirement: Buffer target compatibility
A buffer first bound to `ELEMENT_ARRAY_BUFFER` SHALL NOT be bindable to another non-copy target, and a buffer first bound to any other target SHALL NOT be bindable to `ELEMENT_ARRAY_BUFFER`; such a bind SHALL generate `INVALID_OPERATION` (WebGL 1.0 §6.1, WebGL 2.0 §5.1).

#### Scenario: Element buffer rebound as array buffer
- **WHEN** a buffer bound to `ELEMENT_ARRAY_BUFFER` is bound to `ARRAY_BUFFER`
- **THEN** `INVALID_OPERATION` is generated and `ARRAY_BUFFER_BINDING` is unchanged (cf. Khronos `conformance/buffers/buffer-bind-test.html`)

### Requirement: Buffer data
`bufferData` SHALL accept a size (zero-filled storage) or an `ArrayBuffer`/`ArrayBufferView`/`SharedArrayBuffer` source, and `bufferSubData` a source at a byte offset (WebGL 1.0 §5.14.5). On WebGL 2 the `ArrayBufferView` forms SHALL take `srcOffset` and `length` in elements, generating `INVALID_VALUE` when they exceed the view (WebGL 2.0 §3.7.3). A `null` source SHALL generate `INVALID_VALUE`, and a negative size or offset `INVALID_VALUE`.

#### Scenario: Data round trip (WebGL 2)
- **WHEN** `bufferData(ARRAY_BUFFER, new Float32Array([1, 2, 3, 4]), STATIC_DRAW)`, then `bufferSubData(ARRAY_BUFFER, 4, new Float32Array([9]))` and `getBufferSubData(ARRAY_BUFFER, 0, out)` with a 4-element `Float32Array`
- **THEN** `out` is `[1, 9, 3, 4]` (cf. Khronos `conformance2/buffers/get-buffer-sub-data.html`)

#### Scenario: Size form is zero-filled
- **WHEN** `bufferData(ARRAY_BUFFER, 16, STATIC_DRAW)` and then `getBufferSubData` of all 16 bytes
- **THEN** every byte is `0`

#### Scenario: srcOffset beyond the view
- **WHEN** a WebGL 2 context calls `bufferData(ARRAY_BUFFER, new Uint8Array(4), STATIC_DRAW, 5)`
- **THEN** `INVALID_VALUE` is generated (cf. Khronos `conformance2/buffers/bound-buffer-size-change-test.html`)

#### Scenario: Shared memory
- **WHEN** `bufferData` takes a `Uint8Array` on a `SharedArrayBuffer`
- **THEN** the buffer holds the view's bytes at the time of the call

### Requirement: Buffer queries and copies
`getBufferParameter` SHALL return `BUFFER_SIZE` and `BUFFER_USAGE` as numbers (WebGL 1.0 §5.14.5). On WebGL 2, `copyBufferSubData` and `getBufferSubData` SHALL behave as WebGL 2.0 §3.7.3 specifies, `getBufferSubData` generating `INVALID_VALUE` when the range exceeds the buffer or the destination.

#### Scenario: Buffer size
- **WHEN** `bufferData(ARRAY_BUFFER, 12, DYNAMIC_DRAW)` is called and both parameters are queried
- **THEN** `BUFFER_SIZE` is `12` and `BUFFER_USAGE` is `DYNAMIC_DRAW` (cf. Khronos `conformance/buffers/buffer-data-and-buffer-sub-data.html`)

#### Scenario: Copy between buffers
- **WHEN** a WebGL 2 context copies 4 bytes from a `COPY_READ_BUFFER` to a `COPY_WRITE_BUFFER` with `copyBufferSubData`
- **THEN** `getBufferSubData` on the destination reads the copied bytes

### Requirement: Detached buffer sources
`bufferData` and `bufferSubData` SHALL treat an `ArrayBuffer` or `ArrayBufferView` whose buffer is detached as a source of zero bytes, and SHALL NOT throw for it. On WebGL 2, `srcOffset` and `length` SHALL apply to those zero bytes, so a range past them generates `INVALID_VALUE`, as for any short view (WebGL 2.0 §3.7.3).

#### Scenario: Detached source
- **WHEN** a `Float32Array`'s buffer is detached with `ArrayBuffer.prototype.transfer()`, and `bufferData(ARRAY_BUFFER, view, STATIC_DRAW)` and `bufferData(ARRAY_BUFFER, view.buffer, STATIC_DRAW)` are called
- **THEN** neither call throws, `getBufferParameter(ARRAY_BUFFER, BUFFER_SIZE)` is `0`, and `getError()` is `NO_ERROR`

#### Scenario: Detached source of bufferSubData (WebGL 2)
- **WHEN** on a WebGL 2 context a 16-byte buffer holds data, and `bufferSubData(ARRAY_BUFFER, 0, view)` is called with a view whose buffer is detached
- **THEN** the call does not throw, the buffer's bytes are unchanged, and `getError()` is `NO_ERROR`

#### Scenario: Range on a detached source (WebGL 2)
- **WHEN** a WebGL 2 context calls `bufferData(ARRAY_BUFFER, view, STATIC_DRAW, 1)` with a view whose buffer is detached
- **THEN** `INVALID_VALUE` is generated

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
