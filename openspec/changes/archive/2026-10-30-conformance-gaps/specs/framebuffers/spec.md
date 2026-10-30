# Spec Delta

## ADDED Requirements

### Requirement: Empty attachment queries
For an empty attachment point of a framebuffer object, `getFramebufferAttachmentParameter` SHALL return `NONE` for `OBJECT_TYPE` and, other than for `OBJECT_NAME` on WebGL 2 (`null`), generate `INVALID_ENUM` on WebGL 1 and `INVALID_OPERATION` on WebGL 2.

#### Scenario: Name of an empty point on WebGL 1
- **WHEN** `FRAMEBUFFER_ATTACHMENT_OBJECT_NAME` is queried for an empty point on WebGL 1
- **THEN** it returns `null` with `INVALID_ENUM` (cf. Khronos `conformance/misc/object-deletion-behaviour.html`)

### Requirement: Color attachments past the maximum
`COLOR_ATTACHMENTi` with `i` at or past `MAX_COLOR_ATTACHMENTS` SHALL generate `INVALID_ENUM` in attachment calls and queries, and generate no other error.

#### Scenario: Attaching past the maximum
- **WHEN** a texture is attached at `COLOR_ATTACHMENT0 + MAX_COLOR_ATTACHMENTS`, then at the last valid point
- **THEN** the first generates `INVALID_ENUM` and the second no error (cf. Khronos `conformance2/rendering/draw-buffers.html`)
