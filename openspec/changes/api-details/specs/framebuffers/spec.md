# Spec Delta

## ADDED Requirements

### Requirement: Multisampled DEPTH_STENCIL
`renderbufferStorageMultisample` with `DEPTH_STENCIL` and more than 0 samples SHALL generate `INVALID_OPERATION`; `DEPTH24_STENCIL8` is the multisampled form.

#### Scenario: Multisampled alias rejected
- **WHEN** `renderbufferStorageMultisample(RENDERBUFFER, 1, DEPTH_STENCIL, 1, 1)` is called
- **THEN** it generates `INVALID_OPERATION` (cf. Khronos `conformance2/renderbuffers/multisampled-depth-renderbuffer-initialization.html`)
