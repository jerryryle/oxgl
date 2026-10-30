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
