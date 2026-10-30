# Spec Delta

## ADDED Requirements

### Requirement: DEPTH_STENCIL_ATTACHMENT per version
On WebGL 1, `DEPTH_STENCIL_ATTACHMENT` SHALL be an attachment point of its own (WebGL 1.0 §6.6). On WebGL 2 it SHALL attach at the depth and stencil points, and its `OBJECT_NAME` SHALL be the object at both, `null` when both are empty, with `INVALID_OPERATION` when they differ.

#### Scenario: WebGL 1 combined point
- **WHEN** a `DEPTH_STENCIL` renderbuffer is attached at `DEPTH_STENCIL_ATTACHMENT` on WebGL 1
- **THEN** `getFramebufferAttachmentParameter(FRAMEBUFFER, DEPTH_STENCIL_ATTACHMENT, FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)` returns it (cf. Khronos `conformance/misc/expando-loss.html`)
