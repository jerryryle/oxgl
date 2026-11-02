# Design

## Context

- `crates/oxgl-sys/build.rs` already loads a platform's symbols archive when `OXGL_ANGLE_SYMBOLS=1` and fails the build when `bundles.toml` pins none for that platform key, which is the survey's x64 ASan failure mode. It verifies the archive's digest before extracting, like the bundle.
- The survey's x64 ASan job ran without `OXGL_ANGLE_SYMBOLS`, so LeakSanitizer saw stripped ANGLE frames and `leak:egl::GetCurrentThread` could not match.
- `conformance/pool.mjs` reports `TIMEOUT` when its idle timer fires before the page process exits. For `abort.html` the timer is the harness test's 10 s, started by the page's last result just before `process.abort()`. On Linux arm64 and macOS the exit arrives at once as `SIGABRT`. On x64 it did not arrive within 10 s. Node's `ABORT()` prints a native and a JavaScript backtrace before calling `abort()`, and systemd-coredump then collects the core; either step may be slow or stuck in a process that has ANGLE, SwiftShader and their threads loaded, which the plain-Node probe did not have.

## Goals / Non-Goals

**Goals:**
- Build, test and ASan green on Linux x64.
- A per-page conformance comparison with Linux arm64.

**Non-Goals:**
- Re-enabling Linux x64 in CI (linux-arm64-focus 4.5).

## Decisions

- **Pin the already-published x64 symbols archive** from the `angle-8078.4` release's `SHA256SUMS`. No ANGLE rebuild or new release is needed, and the existing verified-download path in `build.rs` is reused unchanged.
- **Diagnose before fixing the `TIMEOUT`.** The scratch workflow runs the abort fixture on `ubuntu-24.04` with timing and the page's stderr, with and without core collection (`ulimit -c 0` alone does not stop a piped handler, and `Storage=none` still reads and processes the core; `ProcessSizeMax=0` in `/etc/systemd/coredump.conf` skips processing, or `kernel.core_pattern` can be pointed away from systemd-coredump for the run), and with the page's backtrace output visible, to find which step takes the time. The fix follows from the cause: for example, if only core collection is slow, the runner can disable core dumps for its page processes. It is written into this change's tasks and reviewed before it is made.
- **Survey and comparison on a scratch branch**, as in linux-arm64-focus 4.2: a workflow of its own, never merged, that does not run the regular CI. The conformance comparison runs `ubuntu-24.04` and `ubuntu-24.04-arm` in the same run so both outcomes come from one commit. When port-windows and port-linux-x64 are applied together, one scratch workflow with a platform matrix serves both, with one Linux arm64 reference leg.
- **Runner speed is ruled out before a difference is attributed.** Before attributing a difference, re-run each differing page alone (`--jobs 1`) with a long limit (`--timeout 120`) on the same runner: a page that then passes is slow on that runner, not different, as with the macOS comparison (linux-arm64-focus task 4.3). Record those pages too, with their longest gap at the default settings and alone, for the CI decision in linux-arm64-focus task 4.6.
- **Conformance differences are fixed or agreed.** A Linux-x64-only difference that is an oxgl bug is fixed here (added to tasks and reviewed first). One caused by ANGLE or SwiftShader on x64 is recorded with its cause for the user to agree, and how platform-specific expectations are stored is proposed then.

## Risks / Trade-offs

- [The suppression may not match on x64 even with symbols] → two likely causes. If ANGLE's release build omits frame pointers, the x64 job's fast malloc unwinder stops at the ANGLE boundary and never sees `egl::GetCurrentThread`; the survey job then sets `fast_unwind_on_malloc=0`, as arm64 does, and the option is recorded for linux-arm64-focus task 4.5, which re-enables the x64 job in CI. If the frames are visible but differ (for example through inlining), a new narrow entry naming the x64 frame is proposed under the leak-suppression rules.
- Safety rules: the expected changes are a pin and JavaScript; no `unsafe` code, handles or ArrayBuffer lifetimes are touched. If the diagnosis points into oxgl's native code, the fix is reviewed against the safety rules before it is made.
