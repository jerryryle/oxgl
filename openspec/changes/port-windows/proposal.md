# Proposal

## Why

The platform survey (linux-arm64-focus task 4.2, run 41159724941) found Windows x64 and Windows arm64 failing the same two harness tests, and nothing else: `npm ci`, the build, `lint:rust` and `cargo test` pass on both. Both platforms must pass build and test before their conformance comparison and restore (linux-arm64-focus tasks 4.3 and 4.5). One change covers both because the failures and the fixes are identical; the conformance comparison is still done per platform.

## What Changes

- **A Node abort on Windows is a `CRASH`.** Node implements `process.abort()` on Windows as `_exit(134)` (`ExitCode::kAbort`), not as the C runtime's `abort()`, which exits with code 3. The runner only knows code 3 and `0xC…` statuses, so a page that aborts Node is reported as a harness error instead of `CRASH`. The runner treats exit code 134 on Windows as an abort too.
- **Files check out with LF line endings on every host.** Git for Windows converts text files to CRLF on checkout, so the suite-server test reads `served.txt` as `served\r\n`. A repository `.gitattributes` makes Git store and check out text files with LF everywhere.
- **Build-and-test survey, then conformance on each Windows platform.** On a scratch branch, the survey's build-and-test workflow runs on `windows-2025` and `windows-11-arm` until both are green. Then both conformance suites run on each, and every page outcome is compared with Linux arm64 on the same commit. Differences are fixed or recorded as platform expectations for the user to agree, which is itself a decision for this change's review.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace`: a new requirement that text files have LF line endings in every checkout.
- `conformance-testing`: Page outcome gains a scenario for a Node abort on Windows (exit code 134).

## Impact

- `conformance/pool.mjs` (`isNativeAbort`), `test/conformance-harness.test.mjs` (the abort-at-teardown message assertion accepts code 134), a new `.gitattributes`.
- No change to oxgl's native code or ANGLE is expected from the survey. If conformance shows Windows-only page differences in oxgl, their fixes are added to this change's tasks for review before they are made.
- CI is unchanged here. Re-enabling the Windows `PLATFORM-FOCUS` entries, adding the triples to `napi.targets` and the supported-platform spec deltas stay with linux-arm64-focus tasks 4.5 and 4.6.

## Out of Scope and Extension Points

- **Windows conformance in CI.** The comparison runs once on a scratch branch. Whether the conformance job gains Windows (or any non-Linux-arm64) matrix entries is decided in linux-arm64-focus task 4.6.
- **The D3D11 GPU backend.** GitHub's Windows runners have no GPU, so only SwiftShader is tested, as on Linux arm64.
