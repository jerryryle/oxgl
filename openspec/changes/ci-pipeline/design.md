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
                               → restore ANGLE cache (key: os + bundle sha256) → npm ci
                               → cargo fmt --check → cargo clippy … -D warnings
                               → cargo test --workspace --exclude oxgl-node
                               → npm run lint → npm run build → OXGL_BACKEND=software npm test
  node-range      ubuntu-24.04, matrix node: [22.12.0, 26]   build + OXGL_BACKEND=software npm test
  asan            ubuntu-24.04, pinned nightly          see below
  gpu             self-hosted label `oxgl-gpu`; `if: vars.OXGL_GPU_RUNNER == 'true'`  (extension point)
  ci              needs: [workflow-lint, check, node-range, asan]; if: always();
                  fails unless every need's result == 'success'
```

Runner images are pinned by version label (not `-latest`) so image rollovers are deliberate. The main matrix uses the active LTS Node (24); `node-range` covers both ends of `engines` (the exact floor 22.12.0, and 26 current) on Linux only to keep cost down, since N-API makes the addon Node-version-independent and per-platform risk is already covered by `check`.

`ANGLE` cache: `actions/cache` keyed `angle-${{ runner.os }}-${{ <sha256 from angle/pin.toml> }}`, restored into the cache directory `oxgl-sys/build.rs` already uses (`OXGL_ANGLE_CACHE`). The build script still verifies the digest after restore, so a poisoned cache entry fails the build instead of being used.

### AddressSanitizer job

- Toolchain: a pinned nightly (`nightly-YYYY-MM-DD` in the workflow, bumped deliberately), because `-Zsanitizer=address` is nightly-only.
- `RUSTFLAGS="-Zsanitizer=address -Cforce-frame-pointers=yes"`, `cargo test --workspace --exclude oxgl-node -Zbuild-std --target x86_64-unknown-linux-gnu`. Excluding oxgl-node, which has `[lib] test = false`, keeps Cargo's feature merging from turning on oxgl-sys's `node` feature, so no test executable references Node-API symbols. Test executables link the ASan runtime and load ANGLE from the staged bundle directory via `oxgl_sys::test_support::bundle_dir()` (`test-support` feature), so the Rust integration tests that drive real ANGLE/SwiftShader contexts (including the 1,000-cycle soak with live-object counters) run fully under ASan.
- `ASAN_OPTIONS=detect_leaks=1:halt_on_error=1:detect_stack_use_after_return=1`, `LSAN_OPTIONS=suppressions=.github/lsan-suppressions.txt`.
- ANGLE/SwiftShader are not instrumented (prebuilt), but ASan intercepts `malloc`/`free` process-wide, so heap misuse in our code involving memory crossing the FFI boundary is still caught, and LSan sees leaks of ANGLE-allocated memory.
- **Suppressions are by specific stack frame (process-lifetime caches and static initialization), never whole libraries.** Suppressing `libGLESv2` wholesale would hide exactly the bug class we care about: forgetting to destroy an EGL/GL object leaks memory allocated inside ANGLE. Each entry carries a comment explaining why it's a one-time allocation. The live-object counter test is a second, sanitizer-independent net for that bug class.

*Alternative considered:* running `node --test` with `LD_PRELOAD` of the compiler-rt ASan runtime matching rustc's LLVM. It covers the napi-rs layer and JS-driven paths (e.g. the ArrayBuffer detach test), but is fragile (runtime/LLVM version matching, Node's own allocations producing noise). Deferred to a follow-up change; the Rust suites cover `oxgl-core` and `oxgl-sys`, where all `unsafe` lives.

### Workflow security

- All `uses:` pinned to 40-hex SHAs with a trailing `# vX.Y.Z` comment; Dependabot (github-actions ecosystem) proposes bumps.
- `permissions: contents: read` at workflow level; no job needs write access.
- Only `pull_request` (never `pull_request_target`), so fork PRs get no secrets. No secrets are needed: ANGLE bundles are public release assets.
- `zizmor` and `actionlint` enforce the above in the `workflow-lint` job.

### Soak test duration

Each SwiftShader context create/destroy includes ANGLE's internal shader compilation, and ASan multiplies the cost. Per-cycle time is measured in the first CI runs. If the full 1,000-cycle soaks push a job past the budget below, the full count keeps running on the Linux `check` job, the ASan job and a scheduled nightly run. macOS and Windows PR runs then set `OXGL_SOAK_ITERATIONS=200`.

### Cost

Per PR: 3 platform jobs + 2 Linux node-range jobs + 1 ASan job + 1 lint job. Estimated runtime after caches warm: Linux ~8-10 min, Windows ~12-15 min, macOS ~8-10 min, ASan ~15-20 min (build-std is the main cost). On a public repository standard runners are free; on a private one macOS minutes dominate, and the macOS job could be limited to pushes to `main` plus a PR label if needed.

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
