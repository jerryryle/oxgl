## MODIFIED Requirements

### Requirement: Software backend
`backend: 'software'` SHALL create the context on SwiftShader through ANGLE, and SHALL work on machines with no GPU and no GPU drivers installed. SwiftShader SHALL be built with high-precision texture filtering (`SWIFTSHADER_HIGH_PRECISION_FILTERING`), as Chromium builds it, so that filtered sampling of normalized fixed-point textures matches Chrome's software renderer.

#### Scenario: Forced software on a GPU machine
- **WHEN** `backend: 'software'` is used on a machine that has a GPU
- **THEN** the context renders with SwiftShader, not the GPU

#### Scenario: Linear filtering of a white texel is exact
- **WHEN** a software context samples a 1×1 `RGBA`/`UNSIGNED_BYTE` texture holding `[255, 255, 255, 255]` with `LINEAR` filtering in a fragment shader
- **THEN** the sampled red component compares equal to `1.0`, and Khronos `conformance/uniforms/uniform-default-values.html` passes on WebGL 1 and WebGL 2
