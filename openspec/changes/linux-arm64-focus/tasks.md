# Tasks

## 1. ANGLE recipe for five targets

- [ ] 1.1 Add `angle/args/linux-arm64.gn` (`target_cpu = "arm64"`, no X11/Wayland) and `angle/args/windows-arm64.gn` (`target_cpu = "arm64"`, D3D11 on, D3D9 off). Move `target_cpu` out of `common.gn` into each platform file, and bump `bundle_version` in `angle/pin.toml` to `angle-8078.2`. Verify that `check_pin.py --allow-unpublished` passes once 1.3 lands.
- [ ] 1.2 Teach `angle/build.sh` the `linux-arm64` platform: set `target_cpu = ['arm64']` in `.gclient` so `gclient sync` installs the arm64 sysroot. Give `angle/build.ps1` a platform parameter (`windows-x64` | `windows-arm64`). Verify locally or in a PR run that `gn gen` succeeds for both new platforms and that `bundle.py --preflight` passes.
- [ ] 1.3 Extend `angle/scripts/bundle.py` and `check_pin.py` to the five platform keys. Apply the Linux checks to both Linux keys and add the 64 KiB `LOAD`-alignment check for `linux-arm64`. Record the smallest alignment in build-info. Unit-check the alignment check against libraries linked with `-z max-page-size=4096` and `-z max-page-size=16384`, which must be rejected and named.
- [ ] 1.4 Update `.github/workflows/angle-build.yml`: five build entries (arm64 ones on the x64 runners, with the VS ARM64 component added on Windows), `smoke (linux-arm64)` on `ubuntu-24.04-arm` and `smoke (windows-arm64)` on `windows-11-arm` from the uploaded artifacts, and `release` needing every build and smoke job. Verify that a pull request run builds and smoke-tests all five, and that actionlint and zizmor pass.
- [ ] 1.5 Release `angle-8078.2` from `main` via `workflow_dispatch` and record the five digests in `angle/bundles.toml`. Verify that `check_pin.py` passes without `--allow-unpublished`. If `windows-arm64` cannot be built, stop and ask the user whether to defer that bundle, recording the failure here.
- [ ] 1.6 Update `angle/README.md` (platforms, cross-compiling, the page-size alignment check) and verify that the documented local commands match the scripts.

## 2. oxgl on Linux arm64

- [ ] 2.1 Add the `linux-arm64` and `windows-arm64` entries to `crates/oxgl-sys/build.rs` and the triples to `scripts/stage-angle.mjs`. Verify that `cargo build` and `npm run build` still succeed on macOS arm64 locally (unsupported but buildable).
- [ ] 2.2 Set `package.json` `napi.targets` to `["aarch64-unknown-linux-gnu"]` (edit in place, keep `@fission-ai/openspec`). Add `aarch64-unknown-linux-gnu` and `aarch64-pc-windows-msvc` to `deny.toml` and `about.toml`, and regenerate `THIRD_PARTY_NOTICES`. Verify that `npm run lint:licenses` passes.
- [ ] 2.3 Fix any `c_char` or other aarch64 compile issues in `oxgl-sys`. Verify that `cargo clippy --workspace --all-targets --locked -- -D warnings` and `cargo test --workspace --exclude oxgl-node --locked` pass on an arm64 runner (in 3.1's CI run).
- [ ] 2.4 Check the built addon (`dist/*.node`) and bundle libraries with `readelf -lW` on Linux arm64: every `LOAD` alignment must be at least `0x10000`. Record the values here.
- [ ] 2.5 Update `README.md` (supported platform: Linux arm64; other hosts build locally but are unsupported), `CONTRIBUTING.md` (job table), and `openspec/config.yaml`'s target-platform line (Linux arm64 during the focus, with the five eventual targets). Verify that the documented commands run as written on Linux arm64.

## 3. CI focus on Linux arm64

- [ ] 3.1 First, on a branch, run only the `asan` job on `ubuntu-24.04-arm` (`--target aarch64-unknown-linux-gnu`) and record its result here. If LeakSanitizer reports one-time allocations inside a third-party component, pin the `linux-arm64` `-symbols` archive's URL and SHA-256 in `angle/bundles.toml` (from the release's `SHA256SUMS`). Make the job fetch it through the same verify-before-extract path as the main bundle, verifying that a wrong digest fails, then add narrow, justified suppressions naming those internal functions, per the leak-suppression rules. Fix any report in oxgl code. If neither applies, stop and ask the user. Then, in `.github/workflows/ci.yml`: set `check`'s matrix to `ubuntu-24.04-arm`, move `node-range` and `asan` (with `--target aarch64-unknown-linux-gnu`) to `ubuntu-24.04-arm`, and leave every replaced entry and line commented with `# PLATFORM-FOCUS: re-enable`. Add `runner.arch` to the ANGLE and Cargo cache keys, and install rustup where the arm64 image lacks it. Verify that a pull request run is green, that actionlint and zizmor pass, and that `grep -n PLATFORM-FOCUS .github/workflows/ci.yml` lists every disabled entry.
- [ ] 3.2 Update `openspec/changes/conformance-harness` (proposal, CI spec delta, design, tasks) so its CI job runs on `ubuntu-24.04-arm` (Linux arm64). Verify with `npx openspec validate conformance-harness --strict`.
- [ ] 3.3 Run `npx openspec sync` for this change so the main specs describe the Linux arm64 focus, and verify with `npx openspec validate --specs --strict`.

## 4. Restore every platform (at the end of the standards-compliance work)

- [ ] 4.1 Confirm with the user that oxgl is fully standards-compliant on Linux arm64 (the conformance expectations file is empty, or every remaining entry is agreed), and that the restore should start now.
- [ ] 4.2 Survey the other platforms. On a scratch branch, re-enable every `# PLATFORM-FOCUS` entry in `ci.yml` and add `windows-11-arm` to `check`, all outside the required `ci` check. Run the full CI, including both conformance suites, and record each platform's failures here: build, Rust tests, Node tests, ASan and conformance differences from Linux arm64.
- [ ] 4.3 From the survey, propose one OpenSpec change per platform that needs work (for example `port-windows-arm64`), each with its own proposal, specs and tasks for the user to review. List them here. This change stays open until every one is archived.
- [ ] 4.4 As each port change lands, make its platform required again: re-enable that platform's `PLATFORM-FOCUS` entries (diffing each against its live arm64 counterpart for drift), add its triple to `napi.targets`, and verify that `ci` is green with the platform required. When the last platform is restored, verify that `grep -rn PLATFORM-FOCUS .github` finds nothing.
- [ ] 4.5 Add spec deltas to this change for the restored state: node-api supported hosts (all five targets) and the continuous-integration platform matrix (including Windows arm64). Update `README.md`, `CONTRIBUTING.md` and `openspec/config.yaml`. Verify with `npx openspec validate linux-arm64-focus --strict`, then archive.

## Workflow follow-up

- Sync this change's specs right after group 3 (task 3.3). The change stays open through the whole compliance effort and is archived only after group 4, once every port change it spawned is archived.
