# Proposal

## Why

The safety rules (no unsafe outside `oxgl-sys`, no panics, pedantic clippy, no leaks or memory errors) and the three-platform promise are only real if every change is checked automatically on every platform. A memory-safety bug in FFI code is invisible to ordinary tests, so a sanitizer job is part of the baseline, not an add-on.

## What Changes

- Add a GitHub Actions workflow that runs on pull requests and pushes to `main`, with a matrix over Linux x64, macOS arm64, and Windows x64 running: rustfmt check, clippy (pedantic, warnings as errors), Rust tests, the JS lint/type check, the native + TS build, and the Node test suite with `OXGL_BACKEND=software`.
- Add a Linux AddressSanitizer job (with LeakSanitizer) that runs the Rust test suites, including the SwiftShader integration and soak tests from `headless-context`.
- Cache the verified ANGLE bundle and Cargo/npm dependencies; never rebuild ANGLE in this pipeline.
- Pin all actions by commit SHA and give workflows least-privilege permissions.

## Capabilities

### New Capabilities
- `continuous-integration`: The automated checks every change must pass: which jobs run, on which platforms and triggers, what they verify, how they obtain ANGLE, and the security posture of the workflows themselves.

### Modified Capabilities

None.

## Impact

- New: `.github/workflows/ci.yml`, `.github/lsan-suppressions.txt`, `.github/dependabot.yml` (GitHub Actions ecosystem only, to keep SHA pins current).
- Uses the scripts from `bootstrap-workspace`, the bundle pin and cache from `angle-acquisition`, and the test suites from `headless-context`. It can merge after `bootstrap-workspace` with Node/ASan steps that become meaningful as later changes land; the full pipeline is green only once all three are applied.
- Branch protection on `main` should require the aggregate `ci` check (a repository setting, done by a maintainer).

## Out of Scope and Extension Points

- GPU test runs: GitHub-hosted runners don't provide usable GPUs for Linux/Windows. The workflow defines a `gpu` job slot that is skipped unless a self-hosted runner label is configured.
- Khronos conformance suite runs (later change adds a job to the same workflow).
- Release/publish workflows and prebuilt npm packages.
- Sanitizers other than ASan/LSan (MSan, TSan), and Miri. The ASan job is structured so further sanitizer jobs can be added as matrix entries.
- Running the Node test suite itself under ASan (requires preloading the sanitizer runtime into `node`); noted as a follow-up in design.md.
