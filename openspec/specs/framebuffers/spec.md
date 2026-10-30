# framebuffers Specification

## Purpose
Covers framebuffer and renderbuffer objects, their attachments, completeness and queries, the drawing buffer as framebuffer `null`, and WebGL 2's blit, draw and read buffers, invalidation and buffer clears (WebGL 1.0 §5.14.6–§5.14.7, WebGL 2.0 §3.7.4–§3.7.5).

## Requirements

### Requirement: Framebuffer and renderbuffer objects
`createFramebuffer`, `bindFramebuffer`, `deleteFramebuffer`, `isFramebuffer`, `createRenderbuffer`, `bindRenderbuffer`, `deleteRenderbuffer`, `isRenderbuffer`, `renderbufferStorage` and `getRenderbufferParameter` SHALL behave as WebGL 1.0 §5.14.6–§5.14.7 specify, with the objects following the `webgl-objects` rules.

#### Scenario: Render to a texture
- **WHEN** a texture is attached to a framebuffer's `COLOR_ATTACHMENT0`, the framebuffer is bound, cleared to blue, unbound, and the texture is drawn to the drawing buffer
- **THEN** `checkFramebufferStatus` was `FRAMEBUFFER_COMPLETE` and the drawing buffer reads blue (cf. Khronos `conformance/framebuffers/framebuffer-object-attachment.html`)

#### Scenario: Renderbuffer storage
- **WHEN** a `RGBA4` renderbuffer of 3×5 is allocated
- **THEN** `getRenderbufferParameter(RENDERBUFFER, RENDERBUFFER_WIDTH)` is `3`, `RENDERBUFFER_HEIGHT` is `5` and `RENDERBUFFER_INTERNAL_FORMAT` is `RGBA4`

### Requirement: The drawing buffer is framebuffer null
Binding `null` SHALL bind the drawing buffer. Deleting a bound framebuffer SHALL leave the drawing buffer bound. With the drawing buffer bound, `checkFramebufferStatus` SHALL return `FRAMEBUFFER_COMPLETE`, and on WebGL 2 `drawBuffers` and `readBuffer` SHALL accept only `BACK` and `NONE` (OpenGL ES 3.0 §4.2.1, §4.3.1).

#### Scenario: Unbind
- **WHEN** a framebuffer is bound, then `bindFramebuffer(FRAMEBUFFER, null)` is called and the context is cleared to red
- **THEN** `readPixels` reads red from the drawing buffer and `getParameter(FRAMEBUFFER_BINDING)` is `null`

#### Scenario: Deleting the bound framebuffer
- **WHEN** the bound framebuffer is deleted and the context is cleared to green
- **THEN** the drawing buffer reads green

#### Scenario: Default draw buffers
- **WHEN** a WebGL 2 context with the drawing buffer bound calls `drawBuffers([COLOR_ATTACHMENT0])`
- **THEN** `INVALID_OPERATION` is generated, and `drawBuffers([BACK])` generates no error

### Requirement: WebGL 1 framebuffer lists
On WebGL 1, framebuffer targets other than `FRAMEBUFFER`, renderbuffer formats other than `RGBA4`, `RGB565`, `RGB5_A1`, `DEPTH_COMPONENT16`, `STENCIL_INDEX8` and `DEPTH_STENCIL`, and attachments other than `COLOR_ATTACHMENT0`, `DEPTH_ATTACHMENT`, `STENCIL_ATTACHMENT` and `DEPTH_STENCIL_ATTACHMENT` SHALL generate `INVALID_ENUM` until an extension adds them (WebGL 1.0 §5.14.6–§5.14.7, §6.6).

#### Scenario: RGBA8 renderbuffer on WebGL 1
- **WHEN** a WebGL 1 context calls `renderbufferStorage(RENDERBUFFER, RGBA8, 1, 1)`
- **THEN** `INVALID_ENUM` is generated (cf. Khronos `conformance/renderbuffers/renderbuffer-initialization.html` and `conformance/misc/invalid-passed-params.html`)

#### Scenario: Depth-stencil attachment
- **WHEN** a `DEPTH_STENCIL` renderbuffer is attached at `DEPTH_STENCIL_ATTACHMENT` beside an `RGBA4` color renderbuffer of the same size
- **THEN** the framebuffer is complete (cf. Khronos `conformance/framebuffers/framebuffer-object-attachment.html`)

### Requirement: Attachment queries
`getFramebufferAttachmentParameter` SHALL behave as WebGL 1.0 §5.14.6 and WebGL 2.0 §3.7.4 specify, returning the attached `WebGLTexture` or `WebGLRenderbuffer` for `FRAMEBUFFER_ATTACHMENT_OBJECT_NAME`. Deleting an attached texture or renderbuffer SHALL detach it from the bound framebuffers.

#### Scenario: Object name
- **WHEN** a renderbuffer is attached at `DEPTH_ATTACHMENT`
- **THEN** `getFramebufferAttachmentParameter(FRAMEBUFFER, DEPTH_ATTACHMENT, FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)` returns it and `FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE` is `RENDERBUFFER`

#### Scenario: Deleted attachment
- **WHEN** the renderbuffer attached to the bound framebuffer is deleted
- **THEN** `FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE` for that attachment is `NONE`

### Requirement: WebGL 2 framebuffer functions
On WebGL 2, `READ_FRAMEBUFFER` and `DRAW_FRAMEBUFFER`, `framebufferTextureLayer`, `blitFramebuffer`, `drawBuffers`, `readBuffer`, `invalidateFramebuffer`, `invalidateSubFramebuffer`, `clearBufferfv`, `clearBufferiv`, `clearBufferuiv`, `clearBufferfi`, `renderbufferStorageMultisample` and `getInternalformatParameter` SHALL behave as WebGL 2.0 §3.7.4–§3.7.5 specify. A blit from the antialiased drawing buffer SHALL read its resolved contents.

#### Scenario: Multisampled render target resolved by a blit
- **WHEN** a 4-sample `RGBA8` renderbuffer framebuffer is cleared to red and blitted to a single-sample texture framebuffer
- **THEN** reading the texture framebuffer gives red (cf. Khronos `conformance2/renderbuffers/multisampled-renderbuffer-initialization.html`)

#### Scenario: Multiple render targets
- **WHEN** a program writes different colors to two outputs with `drawBuffers([COLOR_ATTACHMENT0, COLOR_ATTACHMENT1])`
- **THEN** each attachment holds its output (cf. Khronos `conformance2/rendering/draw-buffers.html`)

#### Scenario: Clear one buffer
- **WHEN** `clearBufferfv(COLOR, 0, [0, 1, 0, 1])` is called on the drawing buffer
- **THEN** it reads green

#### Scenario: Sample counts
- **WHEN** `getInternalformatParameter(RENDERBUFFER, RGBA8, SAMPLES)` is called
- **THEN** it returns an `Int32Array` of supported sample counts, in decreasing order

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

### Requirement: Multisampled DEPTH_STENCIL
`renderbufferStorageMultisample` with `DEPTH_STENCIL` and more than 0 samples SHALL generate `INVALID_OPERATION`; `DEPTH24_STENCIL8` is the multisampled form.

#### Scenario: Multisampled alias rejected
- **WHEN** `renderbufferStorageMultisample(RENDERBUFFER, 1, DEPTH_STENCIL, 1, 1)` is called
- **THEN** it generates `INVALID_OPERATION` (cf. Khronos `conformance2/renderbuffers/multisampled-depth-renderbuffer-initialization.html`)

### Requirement: DEPTH_STENCIL_ATTACHMENT per version
On WebGL 1, `DEPTH_STENCIL_ATTACHMENT` SHALL be an attachment point of its own (WebGL 1.0 §6.6). On WebGL 2 it SHALL attach at the depth and stencil points, and its `OBJECT_NAME` SHALL be the object at both, `null` when both are empty, with `INVALID_OPERATION` when they differ.

#### Scenario: WebGL 1 combined point
- **WHEN** a `DEPTH_STENCIL` renderbuffer is attached at `DEPTH_STENCIL_ATTACHMENT` on WebGL 1
- **THEN** `getFramebufferAttachmentParameter(FRAMEBUFFER, DEPTH_STENCIL_ATTACHMENT, FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)` returns it (cf. Khronos `conformance/misc/expando-loss.html`)
