## ADDED Requirements

### Requirement: DEPTH_STENCIL alias follows accepted storage
`getRenderbufferParameter(RENDERBUFFER, RENDERBUFFER_INTERNAL_FORMAT)` SHALL report `DEPTH_STENCIL` exactly when the renderbuffer's storage comes from a successful `renderbufferStorage` call that named `DEPTH_STENCIL`. A `renderbufferStorage` call that generates an error SHALL leave the reported format unchanged.

#### Scenario: Rejected DEPTH_STENCIL storage
- **WHEN** a renderbuffer allocated as `RGBA4` is given `renderbufferStorage(RENDERBUFFER, DEPTH_STENCIL, -1, 1)`
- **THEN** `INVALID_VALUE` is generated and `RENDERBUFFER_INTERNAL_FORMAT` is still `RGBA4`

#### Scenario: Rejected storage after DEPTH_STENCIL
- **WHEN** a renderbuffer allocated as `DEPTH_STENCIL` is given `renderbufferStorage(RENDERBUFFER, RGBA4, -1, 1)`
- **THEN** `INVALID_VALUE` is generated and `RENDERBUFFER_INTERNAL_FORMAT` is still `DEPTH_STENCIL`
