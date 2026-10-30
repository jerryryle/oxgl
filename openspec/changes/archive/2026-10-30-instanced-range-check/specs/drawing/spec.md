## ADDED Requirements

### Requirement: Instanced attribute range on WebGL 1
On WebGL 1, `drawArraysInstancedANGLE` and `drawElementsInstancedANGLE` SHALL generate `INVALID_OPERATION` and draw nothing when an enabled attribute with a nonzero divisor, read by the current program, would be fetched past the end of its buffer for the requested instance count (WebGL 1.0 §6.6), whatever the backend's robust buffer access.

#### Scenario: Instance count past the buffer
- **WHEN** an instanced attribute with divisor 1 has data for two instances and a draw asks for three
- **THEN** `INVALID_OPERATION` is generated (cf. Khronos `conformance/extensions/angle-instanced-arrays-out-of-bounds.html`)

#### Scenario: Attribute the program does not read
- **WHEN** the same attribute is enabled but the current program does not read its location
- **THEN** the draw generates no error
