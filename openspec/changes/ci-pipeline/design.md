# Design

## Context

See proposal.md for motivation. Inputs from earlier changes: `npm run lint|build|test` and the pinned toolchain (`bootstrap-workspace`); the ANGLE pin, digest-keyed cache and `OXGL_ANGLE_DIR` override (`angle-acquisition`); Rust SwiftShader integration/soak tests and Node suites (`headless-context`). GitHub-hosted runners have no usable GPU on Linux/Windows; macOS arm64 runners expose a paravirtualized Metal device.

## Goals / Non-Goals

**Goals:** catch lint, test, platform, and memory-safety regressions on every PR in roughly 15-20 minutes wall time; keep the workflow itself hard to abuse.

**Non-Goals:** GPU coverage, conformance runs, releases (see proposal).

## Decisions

### Workflow shape (`.github/workflows/ci.yml`)

```
on: pull_request (main), push (main)
concurrency: ci-${{ github.ref }}, cancel-in-progress for PRs
permissions: contents: read

jobs:
  workflow-lint   ubuntu       actionlint + zizmor (unpinned-uses, excessive permissions, injection)
  check           matrix:      ubuntu-24.04 (x64), macos-15 (arm64), windows-2025 (x64); Node 24
                  steps:       checkout → toolchain from rust-toolchain.toml → cache cargo/npm
                               → restore ANGLE cache (key: os + hash of angle/bundles.toml) → npm ci
                               → npm run lint:rust (fmt, clippy -D warnings) → npm run lint:js (eslint, tsc)
                               → cargo test --workspace --exclude oxgl-node --locked
                               → npm run build → OXGL_BACKEND=software npm test
  repo-checks     ubuntu-24.04  checkout → toolchain from rust-toolchain.toml → cache cargo registry → Node 24
                                → python3 angle/scripts/check_pin.py --allow-unpublished
                                → install cargo-deny + cargo-about → npm run lint:licenses
  node-range      ubuntu-24.04, matrix node: [22.12.0, 26]   build on Node 24 (the build tooling needs ≥ 22.13),
                                then switch to the matrix Node → OXGL_BACKEND=software npm test
  asan            ubuntu-24.04, pinned nightly          see below
  gpu             self-hosted label `oxgl-gpu`; `if: vars.OXGL_GPU_RUNNER == 'true'`  (extension point)
  ci              needs: [workflow-lint, check, repo-checks, node-range, asan]; if: always();
                  fails unless every need's result == 'success'
```

CI calls the `npm run lint:*` scripts rather than repeating their commands, so local and CI checks stay the same and clippy runs once per platform. Together the `check` and `repo-checks` jobs run all of `npm run lint`. The license check and the ANGLE pin check (`check_pin.py`, which needs Python 3.11+ for `tomllib`; ubuntu-24.04 ships 3.12 as `python3`, while Windows images don't reliably provide `python3`) run once, on Linux. Neither result depends on the host: `deny.toml` lists all three targets, and cargo-about generates its output from the same lockfile. Running it once also avoids installing two tools on every runner, and keeps the byte-for-byte `THIRD_PARTY_NOTICES` comparison off Windows, where checkouts use CRLF line endings.

The `repo-checks` job installs cargo-deny and cargo-about as prebuilt binaries through a SHA-pinned install action, since `cargo install` would compile them on every cache miss. The action must take each tool's checksum from its own manifest, with its fallback to unverified downloaders disabled (`fallback: none` for taiki-e/install-action), so a tool it doesn't list fails the job instead of being fetched unchecked. If a pinned version isn't listed, that tool is installed with `cargo install --locked` instead. Only in that case does the job add a cache of just that tool's binary (`~/.cargo/bin/<tool>`, never the whole directory, which also holds the runner's rustup and its proxies), keyed on the tool's version, so the tool compiles only when its version changes or the cache is evicted. The workflow's `env` holds their pinned versions (`CARGO_DENY_VERSION`, `CARGO_ABOUT_VERSION`, currently 0.20.2 and 0.9.3, cargo-about with its `cli` feature). The README's prerequisites point to those values instead of repeating them, so there is one place to bump.

Runner images are pinned by version label (not `-latest`) so image rollovers are deliberate. The main matrix uses the active LTS Node (24); `node-range` covers both ends of `engines` (the exact floor 22.12.0, and 26 current) on Linux only to keep cost down, since N-API makes the addon Node-version-independent and per-platform risk is already covered by `check`.

`ANGLE` cache: `actions/cache` keyed `angle-${{ runner.os }}-${{ hashFiles('angle/bundles.toml') }}`, restored into the cache directory `oxgl-sys/build.rs` already uses (`~/.cargo/oxgl-angle`). Any digest change changes the manifest's hash, and reading the per-platform digest would need a script step that Windows can't run with `python3`. `build.rs` verifies the digest when it downloads, but uses an extracted cache directory with its `.complete` marker as-is. Pull requests' cache writes are visible only to that pull request, so only runs on `main` can write an entry other branches restore. Re-verifying a cached bundle is a change to angle-distribution, not to CI.

### AddressSanitizer job

- Toolchain: a pinned nightly (`nightly-YYYY-MM-DD` in the workflow, bumped deliberately), because `-Zsanitizer=address` is nightly-only.
- `RUSTFLAGS="-Zsanitizer=address -Cforce-frame-pointers=yes"`, `cargo test --workspace --exclude oxgl-node -Zbuild-std --target x86_64-unknown-linux-gnu`. Excluding oxgl-node, which has `[lib] test = false`, keeps Cargo's feature merging from turning on oxgl-sys's `node` feature, so no test executable references Node-API symbols. Test executables link the ASan runtime and load ANGLE from the staged bundle directory via `oxgl_sys::test_support::bundle_dir()` (`test-support` feature), so the Rust integration tests that drive real ANGLE/SwiftShader contexts (including the 1,000-cycle soak with live-object counters) run fully under ASan.
- `ASAN_OPTIONS=detect_leaks=1:halt_on_error=1:detect_stack_use_after_return=1`, `LSAN_OPTIONS=suppressions=.github/lsan-suppressions.txt`.
- ANGLE/SwiftShader are not instrumented (prebuilt), but ASan intercepts `malloc`/`free` process-wide. Heap misuse in our code involving memory that crosses the FFI boundary is still caught, and LSan reports ANGLE-allocated memory that becomes unreachable.
- **ANGLE comes from the normal pinned bundle.** The ASan job restores the same ANGLE cache as `check`, and `build.rs` downloads and verifies the bundle as usual, with no override. The bundle's libraries are stripped, so frames inside ANGLE show only exported names or `libGLESv2.so+0x…` offsets. The suppression file starts empty: LSan reports only memory that is unreachable at exit, and ANGLE's process-lifetime caches normally stay reachable from globals. If a real report ever needs an ANGLE-internal suppression, a follow-up change pins the release's unstripped Linux libraries (`angle-linux-x64-symbols.tar.xz`, already published with every bundle) and runs the job against them. Until then that machinery isn't worth its cost.
- **Any future suppression names a specific internal function (process-lifetime caches and static initialization), never a whole library.** A whole-library entry such as `leak:libGLESv2` would hide every unreachable ANGLE allocation, including ones our misuse causes. An exported entry point such as `leak:eglInitialize` is just as broad, so it is not allowed either (the spec states both rules). Each entry names an ANGLE-internal function and carries a comment explaining why it is a one-time allocation.
- **What LSan does not catch: undestroyed EGL/GL objects.** Skipping `eglDestroyContext` (or a GL delete) usually leaves the object reachable from ANGLE's process-lifetime `egl::Display`, or `eglTerminate` frees it. Either way LSan has nothing to report. The headless-context live-object counter test is the gate for that bug class. The ASan job runs it, but it is not a sanitizer finding.

*Alternative considered:* running `node --test` with `LD_PRELOAD` of the compiler-rt ASan runtime matching rustc's LLVM. It covers the napi-rs layer and JS-driven paths (e.g. the ArrayBuffer detach test), but is fragile (runtime/LLVM version matching, Node's own allocations producing noise). Deferred to a follow-up change; the Rust suites cover `oxgl-core` and `oxgl-sys`, where all `unsafe` lives.

### Workflow security

- All `uses:` pinned to 40-hex SHAs with a trailing `# vX.Y.Z` comment; Dependabot (github-actions ecosystem) proposes bumps.
- `permissions: contents: read` at workflow level; no job needs write access.
- Only `pull_request` (never `pull_request_target`), so fork PRs get no secrets. No secrets are needed: ANGLE bundles are public release assets.
- `zizmor` and `actionlint` enforce the above in the `workflow-lint` job.

### Soak test duration

Each SwiftShader context create/destroy includes ANGLE's internal shader compilation, and ASan multiplies the cost. Per-cycle time is measured in the first CI runs. If the full 1,000-cycle soaks push a job past the budget below, the full count keeps running on the Linux `check` job, the ASan job and a scheduled nightly run. macOS and Windows PR runs then set `OXGL_SOAK_ITERATIONS=200`.

### Cost

Per PR: 3 platform jobs + 2 Linux node-range jobs + 1 ASan job + 2 Linux lint jobs (`workflow-lint`, `repo-checks`). Estimated runtime after caches warm: Linux ~8-10 min, Windows ~12-15 min, macOS ~8-10 min, ASan ~15-20 min (build-std is the main cost). On a public repository standard runners are free; on a private one macOS minutes dominate, and the macOS job could be limited to pushes to `main` plus a PR label if needed.

## Safety Rules

- *Unsafe confinement / no panics / pedantic:* enforced in CI via clippy with `-D warnings` on all three platforms (lints already encode the rules).
- *Handle model & ArrayBuffer lifetime:* exercised by the headless-context tests that CI runs; ASan + LSan detect the memory-safety and leak failures those rules exist to prevent.

## Risks / Trade-offs

- [Pinned nightly breaks build-std or ASan] → Bump nightly in a dedicated PR; the ASan job is required, so breakage is noticed immediately rather than silently skipped.
- [Soak RSS threshold flakes on shared runners] → Threshold set with headroom (see headless-context); failures report measured growth; the deterministic live-object counter test is the primary leak gate.
- [macOS runner Metal device makes `'auto'` non-deterministic] → All CI Node tests force `OXGL_BACKEND=software`.
- [Suppression list grows to hide real leaks] → Stack-frame-specific entries only, each justified, reviewed like code.

## Open Questions

- Whether the repository will be public (affects runner cost only).
