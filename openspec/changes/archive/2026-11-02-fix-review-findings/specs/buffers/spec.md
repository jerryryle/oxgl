## ADDED Requirements

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
