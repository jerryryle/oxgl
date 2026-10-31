# Design

## Context

The ANGLE recipe builds three bundles natively: `linux-x64` and `macos-arm64` via `angle/build.sh`, and `windows-x64` via `angle/build.ps1`. Each bundle is smoke-tested in the job that built it. `bundle.py` hard-codes the three platforms (GN-arg checks, library names, glibc ≤ 2.31 and no-X11 checks for Linux), as do `check_pin.py`, `oxgl-sys/build.rs`, `scripts/stage-angle.mjs`, `deny.toml`/`about.toml` and `package.json`'s `napi.targets`. CI runs `check` on three OSes and `node-range`/`asan` on `ubuntu-24.04`. The repository is public, so `ubuntu-24.04-arm` and `windows-11-arm` runners (4 vCPU, 16 GB) are free. See proposal.md for motivation.

Linux arm64 distributions differ in kernel page size: 4 KiB is the common default, and some distributions ship 16 KiB or 64 KiB kernels. A shared library whose load segments are aligned for a smaller page size than the kernel's fails to load.

## Goals / Non-Goals

**Goals:**
- Five ANGLE bundles from one pin, each smoke-tested on its own architecture.
- oxgl builds and passes its tests on Linux arm64, and its libraries load under any arm64 page size.
- Restoring the other platforms later means uncommenting CI entries and re-checking them, not porting.

**Non-Goals:**
- Native arm64 ANGLE builds: cross-compiling is enough (see Decisions).
- GPU or larger-page hardware in CI: that is an extension point (see proposal).

## Decisions

### Cross-compile the arm64 bundles on x64 hosts

`linux-arm64` builds on `ubuntu-24.04` with `target_cpu = "arm64"`. ANGLE's DEPS hooks install only the x86 and x64 sysroots, so `build.sh` runs `build/linux/sysroot_scripts/install-sysroot.py --arch=arm64` before `gn gen`. That installs Chromium's arm64 Debian bullseye sysroot (pinned in `sysroots.json`), the same sysroot family that gives the x64 bundle its glibc 2.31 baseline. `windows-arm64` builds on `windows-2025` with `target_cpu = "arm64"`, adding the Visual Studio ARM64 build-tools component the same way the workflow already adds the pinned Windows SDK. `build.ps1` gains a platform parameter instead of hard-coding `windows-x64`.

Alternative: native builds on the arm64 runners. Chromium's toolchain (prebuilt clang, gn, and the sysroot scripts) supports Linux arm64 and Windows arm64 as targets from x64 hosts, which is how Chromium ships those platforms. Hosting builds on arm64 is not a supported Chromium configuration, and the arm runners have half the disk of the x64 ones. Cross-compiling keeps one toolchain path per OS.

### Smoke-test on the target architecture in separate jobs

Build jobs upload their bundle as a run artifact, as they do today. For the three native bundles, the smoke test stays in the build job. Two new jobs, `smoke (linux-arm64)` on `ubuntu-24.04-arm` and `smoke (windows-arm64)` on `windows-11-arm`, download the artifact, compile `angle/smoke/smoke.c` natively (`cc` and `vcvarsarm64.bat` respectively), and run it. The `release` job needs every build and smoke job. The smoke test uses SwiftShader, so the runners need no GPU.

### Page-size compatibility is a bundle check

`bundle.py` reads each Linux arm64 library's program headers (`readelf -lW`) and fails if any `LOAD` segment's alignment is below `0x10000` (64 KiB, the largest arm64 page size). It records the smallest alignment in build-info. lld and GNU ld default to 64 KiB maximum page size on aarch64, so Chromium's output is expected to pass already. If the pinned Chromium build lowers it, the arm64 GN args raise it back with Chromium's `extra_ldflags` (`-Wl,-z,max-page-size=65536`). The oxgl addon is linked by the Rust toolchain's default aarch64 linker, which also defaults to 64 KiB. A task checks it the same way, rather than adding a permanent check for a default nobody changes.

The GitHub arm64 runners use 4 KiB pages, so they cannot exercise larger pages at runtime. For example, SwiftShader's JIT allocates executable memory in page-sized units. Runtime coverage of larger pages waits for a self-hosted runner, and the alignment check covers loading.

### oxgl recognises five targets and declares one

`oxgl-sys/build.rs` and `stage-angle.mjs` gain `aarch64-unknown-linux-gnu → linux-arm64` and `aarch64-pc-windows-msvc → windows-arm64`. `bundle.py`'s per-platform tables follow the same keys, and its Linux-only checks (glibc, display-server linkage, strip) apply to both Linux keys. `napi.targets` lists only `aarch64-unknown-linux-gnu`. `napi build --platform` builds for the host regardless, so local builds on other hosts keep working. `deny.toml` and `about.toml` list all five targets: license data stays complete for every target ANGLE is built for, and nothing ships yet, so extra notices cost nothing.

`std::ffi::c_char` is unsigned on aarch64 Linux and signed on x86_64. Any oxgl-sys code that assumes `i8` for C strings fails to compile on arm64, so compiling and running clippy on the arm64 runner catches it. No new `unsafe` is added, and the existing `// SAFETY:` arguments do not depend on pointer width or char signedness. The handle model, the no-panic rule and the ArrayBuffer lifetime rule are unchanged.

### CI: comment out, don't delete

In `ci.yml`, the `check` matrix keeps only `ubuntu-24.04-arm`. The other `os` entries stay as commented lines, each tagged `# PLATFORM-FOCUS: re-enable`. `node-range` and `asan` move to `ubuntu-24.04-arm`, and `asan` builds `--target aarch64-unknown-linux-gnu`. Each changed line keeps the original as a `# PLATFORM-FOCUS:` comment. `workflow-lint` and `repo-checks` are host-independent and stay on `ubuntu-24.04`. The ANGLE cache key gains `runner.arch` (`angle-${{ runner.os }}-${{ runner.arch }}-…`), so x64 and arm64 Linux never share an entry once both run again. Cargo cache keys already include `matrix.os`, or gain `runner.arch` where they do not.

The arm64 runner images ship fewer preinstalled tools than the x64 ones. The moved jobs use the image's rustup, as the x64 jobs do, and the first pull request run confirms it is present. If it is missing, the job installs a pinned `rustup-init` verified against its published SHA-256, never an unverified `curl | sh`.

LeakSanitizer may see allocations on arm64 that it never saw on x64, because SwiftShader there compiles shaders through its LLVM backend (Subzero is x86-only), and LLVM keeps process-lifetime state. The suppression rules allow only named internal functions of a third-party component, and the published bundle is stripped, so such a report would have no compliant fix. The `asan` job therefore runs on arm64 early (task 3.1 starts with it, before the rest of CI moves). If it reports third-party one-time allocations, the unstripped-libraries follow-up from the ci-pipeline design is done first: the ASan job uses the bundle's `-symbols` archive, so suppressions can name the internal functions. That archive is a downloaded bundle like any other, so angle-distribution's integrity rule applies. `bundles.toml` pins its URL and SHA-256 (from the release's `SHA256SUMS`) next to the main bundle's, and it is fetched through the same verify-before-extract path. It is never downloaded unchecked. Any other report is a real bug to fix. If neither works, stop and ask the user.

What the arm64 run found (task 3.1): `-Zbuild-std` cannot be used on aarch64. It instruments `compiler_builtins`, whose outline atomics `__asan_init` calls before shadow memory exists, so every test binary crashes at startup. The arm64 job uses the prebuilt, uninstrumented std. Heap errors in oxgl code are still caught through ASan's allocator. LeakSanitizer did report a third-party allocation: ANGLE's per-thread `egl::Thread` state, which the README already documents. So the symbols archive is pinned (`symbols_url`, `symbols_sha256`), and with `OXGL_ANGLE_SYMBOLS` set, `oxgl-sys` fetches it through the bundle's verify-before-extract path and points the tests at the unstripped libraries. The suppression names `egl::GetCurrentThread`. ANGLE's arm64 build signs return addresses, which the frame-pointer unwinder cannot follow, so the job sets `fast_unwind_on_malloc=0`.

### The restore is the last task group, and specs are synced early

The user asked that re-enabling the other platforms be a task of this change, done at the very end of the compliance work. A change with an open task group cannot be archived, so its spec deltas would not reach the main specs for months, and the main specs would keep saying "three platforms" while CI runs one. Once the focus has landed, `npx openspec sync` therefore applies this change's deltas to the main specs without archiving. The restore group, when it is done, updates those main specs again (adding Windows arm64), then the change is archived.

Restoring a platform is expected to take real porting work: conformance differences between backends (Metal, D3D11, a different SwiftShader host), platform build issues, and Windows arm64 being new. The restore group therefore does not do that work itself, since specs come before code. It surveys the platforms with every `PLATFORM-FOCUS` entry re-enabled outside the required check. It then spawns one OpenSpec change per platform that needs work, and re-requires each platform in CI as its port change lands. This change stays open as the umbrella until the last port change is archived.

## Risks / Trade-offs

- [SwiftShader on arm64 JIT-compiles with its LLVM backend (Subzero is x86-only), which is slower to build and to run than on x64.] → Accepted. The Node test time limits are checked on the arm64 runner, and conformance-harness's pool and timeout calibration (its task 5.1) already runs there. By the restore, the margin had narrowed: the longest passing gap rose from 1.1 s (conformance-all-cores) to 15 s on `many-draw-calls`, against the half-limit (10 s) rule. Task 4.4 restores it before the platform comparisons: it first separates pages that now pass from a real slowdown, and only then changes the runner's default parallelism or limit, using the worst gap over several runs.
- [The Windows arm64 bundle may not build at the pinned ANGLE revision (SwiftShader or D3D11 on arm64).] → It is built now precisely to find this early. If it fails, the change records the failure and the fix, or the user decides to defer that one bundle. The other four do not depend on it.
- [An arm64 host's hardware Vulkan driver may lack features ANGLE requires, so `backend: 'gpu'` may fail there.] → `auto` then falls back to SwiftShader, per backend-selection. GPU coverage waits for a GPU runner.
- [LeakSanitizer reports third-party one-time allocations on arm64 that cannot be named in a stripped bundle.] → Run `asan` on arm64 first, and use the unstripped symbols for suppressions (see "CI: comment out, don't delete").
- [Commented-out CI drifts from the live jobs over months.] → The restore task diffs each restored entry against its live arm64 counterpart before re-enabling it, and the `PLATFORM-FOCUS` marker makes every site greppable.
- [Platform-specific regressions accumulate unseen on x64 and macOS during the focus.] → Accepted; that is the point of the focus. The restore group runs the full suites on every platform before declaring them supported again.

## Migration Plan

1. Land the recipe changes, release `angle-8078.2` with five bundles, and pin the digests.
2. Land the oxgl and CI changes in one pull request, then run `npx openspec sync` for this change.
3. At the end of the compliance work, do the restore group, then archive.

Rollback before step 3: uncomment the `PLATFORM-FOCUS` entries and restore `napi.targets`. The five bundles stay valid.
