# Tasks

## 1. Workflow skeleton and security

- [ ] 1.1 Add `.github/workflows/ci.yml` with triggers, concurrency, `permissions: contents: read`, and the `workflow-lint` job (actionlint + zizmor); verify a PR with a tag-pinned action fails `workflow-lint`
- [ ] 1.2 Add `.github/dependabot.yml` for the github-actions ecosystem; verify Dependabot config validates in the repository settings view

## 2. Platform check matrix

- [ ] 2.1 Add the `check` job matrix (ubuntu-24.04, macos-15, windows-2025) with toolchain, cargo/npm caches, ANGLE cache keyed by the pinned digest, and the fmt/clippy/test steps; verify a deliberate clippy pedantic violation on a branch fails all three platforms
- [ ] 2.2 Add `npm ci`, `npm run lint` (which includes the license and notices check), `npm run build`, and `OXGL_BACKEND=software npm test` steps; record soak per-cycle time on each platform and in ASan, and apply the reduced macOS/Windows PR count plus a nightly full run if the budget is exceeded (see design); verify the test log shows clear-then-readPixels and soak tests executing (not skipped) on every platform
- [ ] 2.3 Add the `node-range` job (Node 22.12.0 exactly, matching the `engines` floor, and 26 on Linux); verify both pass
- [ ] 2.4 Verify a stale `Cargo.lock` fails CI via `--locked`
- [ ] 2.5 Run `python3 angle/scripts/check_pin.py --allow-unpublished` in the `check` job, so a malformed `angle/bundles.toml` fails its PR (it does not trigger `angle-build`); verify a bundles.toml with an uppercase digest fails

## 3. AddressSanitizer job

- [ ] 3.1 Add the `asan` job (pinned nightly, build-std, ASan/LSan options); verify it runs the SwiftShader integration and soak tests
- [ ] 3.2 Add `.github/lsan-suppressions.txt` with stack-frame-specific, commented entries only; verify no entry suppresses a whole library
- [ ] 3.3 Verify detection on a throwaway branch: an injected use-after-free in `oxgl-sys` test code and a skipped `eglDestroyContext` each fail the job

## 4. Aggregate check and GPU slot

- [ ] 4.1 Add the `ci` aggregate job (`needs` all required jobs, `if: always()`, fails on any non-success); verify it fails when a needed job is cancelled
- [ ] 4.2 Add the `gpu` job gated on the `OXGL_GPU_RUNNER` repository variable; verify it is skipped by default without affecting `ci`

## 5. Documentation

- [ ] 5.1 Document the jobs, how to reproduce each locally (including the ASan command), and the branch-protection setting to require `ci` in `CONTRIBUTING.md`; verify the local ASan command runs as written on Linux

## Workflow follow-up

- A maintainer enables branch protection on `main` requiring the `ci` check.
