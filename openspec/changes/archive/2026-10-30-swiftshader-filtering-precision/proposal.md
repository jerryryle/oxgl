# Proposal

## Why

SwiftShader filters 8-bit normalized textures with 16-bit fixed-point math unless it is compiled with `SWIFTSHADER_HIGH_PRECISION_FILTERING`. With `LINEAR` filtering, a white `RGBA8` texel then samples as about 0.99994 instead of 1.0, so a shader's exact `== 1.0` comparison fails. Khronos `conformance/uniforms/uniform-default-values.html` fails this way on WebGL 1 and WebGL 2, and is an expected failure tagged `SwiftShader:` in `conformance/expectations.txt`.

SwiftShader's `src/Vulkan/BUILD.gn` adds the define only under `build_with_chromium` (crbug.com/726075: Chromium needs high-precision filtering). oxgl's bundles build ANGLE standalone, so they lack it, and oxgl's software backend filters differently from Chrome's, which uses the same SwiftShader revision (`1e80438d2b93` at ANGLE `127e783de334`). No GN argument reaches SwiftShader's compile: Chromium's `build/` takes extra compiler flags only through the cros and unbundle toolchains.

## What Changes

- The recipe in `jerryryle/oxgl-angle` gains `angle/patches/`, holding one patch that makes SwiftShader's `Vulkan/BUILD.gn` add `SWIFTSHADER_HIGH_PRECISION_FILTERING` unconditionally. `build.sh` and `build.ps1` apply every patch there before `gn gen`, skipping one already applied and failing on one that no longer applies. The define is a GN `defines` entry, so it works with clang on Linux and macOS and with clang-cl on Windows. `angle/patches/` joins the recipe paths in `angle-build.yml`, and `bundle_version` becomes `angle-8078.3`.
- oxgl takes `angle-8078.3` in `angle/bundles.toml` once it is released, drops the two `uniform-default-values` expectations, and removes that row from "Known upstream issues" in `angle/README.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `backend-selection`: "Software backend" requires SwiftShader to filter textures at high precision, as Chrome's does.

## Impact

- New ANGLE bundles (`angle-8078.3`) for all five platforms; the GPU backends are unchanged.
- SwiftShader's filtered sampling of 8-bit textures uses 32-bit math instead of 16-bit, which is somewhat slower; `npm run bench` measures it before and after.
- No API change.

## Out of scope

- Other SwiftShader precision differences, such as the deqp `unary_operator_00` (`lowp_uint`) failure. This change records whether that result moves, without targeting it.
- Upstreaming an option to SwiftShader or ANGLE for the define.
