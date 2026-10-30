# Spec Delta

## ADDED Requirements

### Requirement: Reading framebuffer objects and into pack buffers
`readPixels` SHALL read from the framebuffer bound for reading (WebGL 1.0 §5.14.12). On WebGL 2, the `GLintptr offset` overload SHALL write into the buffer bound to `PIXEL_PACK_BUFFER`, and either overload SHALL generate `INVALID_OPERATION` when that binding does not match it (WebGL 2.0 §3.7.10).

#### Scenario: Read from a framebuffer object
- **WHEN** a framebuffer with a texture attachment is bound and cleared to blue, and `readPixels` reads it
- **THEN** it reads blue, while the drawing buffer is unchanged

#### Scenario: Read into a pack buffer
- **WHEN** a WebGL 2 context with a 4-byte `PIXEL_PACK_BUFFER` cleared to red calls `readPixels(0, 0, 1, 1, RGBA, UNSIGNED_BYTE, 0)` and then `getBufferSubData` on the pack buffer
- **THEN** the buffer holds `[255, 0, 0, 255]` (cf. Khronos `conformance2/reading/read-pixels-into-pixel-pack-buffer.html`)

#### Scenario: Mismatched overload
- **WHEN** `readPixels` with an `ArrayBufferView` is called while a pixel pack buffer is bound
- **THEN** `INVALID_OPERATION` is generated
