# Proposal

## Why

The platform survey (linux-arm64-focus task 4.2, run 41159724941) found Windows x64 and Windows arm64 failing the same two harness tests, and nothing else: `npm ci`, the build, `lint:rust` and `cargo test` pass on both. Both platforms must pass build and test before their conformance comparison and restore (linux-arm64-focus tasks 4.3 and 4.5). One change covers both because the failures and the fixes are identical; the conformance comparison is still done per platform.

## What Changes

- **A Node abort on Windows is a `CRASH`.** Node implements `process.abort()` on Windows as `_exit(134)` (`ExitCode::kAbort`), not as the C runtime's `abort()`, which exits with code 3. The runner only knows code 3 and `0xC…` statuses, so a page that aborts Node is reported as a harness error instead of `CRASH`. The runner treats exit code 134 on Windows as an abort too.
- **Files check out with LF line endings on every host.** Git for Windows converts text files to CRLF on checkout, so the suite-server test reads `served.txt` as `served\r\n`. A repository `.gitattributes` makes Git store and check out text files with LF everywhere.
- **SwiftShader no longer crashes on Windows arm64.** The conformance comparison found 13 pages crashing the page process with an access violation on Windows arm64 only. Under cdb the fault is a constant-pool load in SwiftShader's JIT-compiled code, 8 GB away from the routine's read-only data. On arm64, SwiftShader's LLVM JIT maps a routine's code and read-only data as separate allocations and reaches the data with `ADRP`, whose range is ±4 GB. When another reservation lands between the two (here, most likely a V8 WebAssembly memory of 8 GB), the relocation wraps silently. A source patch in the ANGLE recipe maps each routine's sections in one reservation, released as bundle `angle-8078.5` and pinned here.
- **Integer stand-in textures are sampled without filtering.** `webgl-stencil-texturing` reads alpha 0 from an incomplete stencil-mode texture on Linux x64 and on Windows, where the spec requires 1. ANGLE replaces an incomplete integer texture with a stand-in that keeps the default `LINEAR` filters, so the sample asks Vulkan to linearly filter an integer format, which is undefined. SwiftShader filters the raw bits in float math, where 255 becomes a denormal, and flushes denormals to zero on x86 and in MSVC builds, so exactly those platforms read 0. An ANGLE source patch gives the integer stand-ins `NEAREST` filters, with an end-to-end test, released as bundle `angle-8078.6` and pinned here.
- **Expectations can be limited to platforms.** The 18 deqp pages that render to 32-bit integer color buffers fail on x64 only, because of a bug in the WebGL conformance tests: their shaders convert floats just past the 32-bit integer range, which GLSL leaves undefined, and the reference assumes clamping. arm64 clamps and x86 does not. The native dEQP fixed this in 2018 (VK-GL-CTS `6624c8aa`), and the WebGL port never took the fix. These pages are expected to fail on x64. An expectations entry may name the platforms it applies to, and elsewhere the page is expected to pass.
- **Build-and-test survey, then conformance on each Windows platform.** On a scratch branch, the survey's build-and-test workflow runs on `windows-2025` and `windows-11-arm` until both are green. Then both conformance suites run on each, and every page outcome is compared with Linux arm64 on the same commit. Differences are fixed or recorded as platform expectations for the user to agree, which is itself a decision for this change's review.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace`: a new requirement that text files have LF line endings in every checkout.
- `conformance-testing`: Page outcome gains a scenario for a Node abort on Windows (exit code 134). Checked-in expectations gains platform-limited entries, and the conformance command's update scenario defers to it.

## Impact

- `conformance/expectations.mjs` (parsing, judging and updating platform-limited entries), `conformance/expectations.txt` (the 18 x64 entries), CONTRIBUTING.md and the README's platform notes.
- `conformance/pool.mjs` (`isNativeAbort`), `test/conformance-harness.test.mjs` (the abort-at-teardown message assertion accepts code 134), a new `.gitattributes`.
- No change to oxgl's native code. ANGLE changes come through the oxgl-angle recipe: the SwiftShader JIT patch (`angle-8078.5`) and the ANGLE integer stand-in patch (`angle-8078.6`), each pinned in `angle/bundles.toml`. If conformance shows Windows-only page differences in oxgl, their fixes are added to this change's tasks for review before they are made.
- CI is unchanged here. Re-enabling the Windows `PLATFORM-FOCUS` entries, adding the triples to `napi.targets` and the supported-platform spec deltas stay with linux-arm64-focus tasks 4.5 and 4.6.

## Out of Scope and Extension Points

- **The D3D11 GPU backend.** GitHub's Windows runners have no GPU, so only SwiftShader is tested, as on Linux arm64.
