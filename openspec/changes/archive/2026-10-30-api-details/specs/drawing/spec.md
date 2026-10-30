# Spec Delta

## ADDED Requirements

### Requirement: Attribute pointers without a buffer
`vertexAttribPointer` and `vertexAttribIPointer` SHALL generate `INVALID_OPERATION` when no buffer is bound to `ARRAY_BUFFER` and the offset is not 0 (WebGL 1.0 §6.4).

#### Scenario: Integer pointer without a buffer
- **WHEN** `vertexAttribIPointer(0, 1, INT, 0, 4)` is called with no `ARRAY_BUFFER`
- **THEN** it generates `INVALID_OPERATION` (cf. Khronos `conformance2/attribs/gl-vertexattribipointer.html`)
