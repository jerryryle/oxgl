## ADDED Requirements

### Requirement: Parallel compile status on a lost context
With `KHR_parallel_shader_compile` enabled, `getShaderParameter` and `getProgramParameter` SHALL return `true` for `COMPLETION_STATUS_KHR` on a lost context, so a page polling for completion finishes.

#### Scenario: Status after loseContext
- **WHEN** a shader and a program are compiled and linked, and `WEBGL_lose_context.loseContext()` is called
- **THEN** both report `COMPLETION_STATUS_KHR` as `true` (cf. Khronos `conformance/extensions/khr-parallel-shader-compile.html`)

### Requirement: Shared-exponent renderbuffers
On WebGL 2, `renderbufferStorage` and `renderbufferStorageMultisample` SHALL accept `RGB9_E5` while `WEBGL_render_shared_exponent` is enabled, and SHALL generate `INVALID_ENUM` for it otherwise.

#### Scenario: Before and after enabling
- **WHEN** `renderbufferStorage(RENDERBUFFER, RGB9_E5, 1, 1)` is called before and after enabling `WEBGL_render_shared_exponent`
- **THEN** the first call generates `INVALID_ENUM` and the second succeeds (cf. Khronos `conformance2/extensions/webgl-render-shared-exponent.html`)
