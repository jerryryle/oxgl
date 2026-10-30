# Proposal

## Why

Running the Khronos suites on a GPU backend (ANGLE Metal on an Apple GPU) showed two failures that SwiftShader cannot reach, because SwiftShader does not offer the extensions involved:

- `KHR_parallel_shader_compile`: on a lost context, `COMPLETION_STATUS_KHR` must read `true`, so pages polling for completion finish. oxgl returned `null`, as for other pnames.
- `WEBGL_render_shared_exponent`: once enabled, `RGB9_E5` renderbuffers are allowed. oxgl's format list did not include it.

## What Changes

- `getShaderParameter` and `getProgramParameter` return `true` for `COMPLETION_STATUS_KHR` on a lost context while the extension is enabled.
- `renderbufferStorage*` accepts `RGB9_E5` on WebGL 2 with `WEBGL_render_shared_exponent` enabled.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `extensions`.

## Impact

- `src/context.ts`, `crates/oxgl-core/src/framebuffers.rs`. No ABI change.
