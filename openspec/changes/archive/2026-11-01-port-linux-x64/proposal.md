# Proposal

## Why

The platform survey (linux-arm64-focus task 4.2, run 41159724941) found two Linux x64 failures; `npm ci`, the build, `lint:rust` and `cargo test` pass. Linux x64 must pass build and test, including the ASan job, before its conformance comparison and restore (linux-arm64-focus tasks 4.3 and 4.5).

## What Changes

- **The ASan job's leak suppression works on x64.** LeakSanitizer reports ANGLE's known per-thread `egl::Thread` leak (40 + 32 bytes), which `leak:egl::GetCurrentThread` suppresses on arm64. On x64 the frames are unsymbolized because `angle/bundles.toml` pins a symbols archive only for `linux-arm64`. The `angle-8078.4` release already publishes `angle-linux-x64-symbols.tar.xz`; pinning its URL and SHA-256 lets the job load the unstripped libraries, as on arm64.
- **A page that aborts is a `CRASH` on Linux x64.** The harness test's `abort.html`, whose page process calls `process.abort()`, is reported as `TIMEOUT` instead of `CRASH`: the runner saw no exit within the 10 s limit. The cause is not yet known. Slow core dumps are ruled out: both Linux runners pipe cores to systemd-coredump, and a plain Node abort exits in about 1 s on each (scratch run 41202916851). The first task diagnoses it on the x64 runner, and the fix is added to this change for review before it is made.
- **Build-and-test survey, then conformance.** On a scratch branch, the survey's build-and-test and ASan jobs run on `ubuntu-24.04` until green. Then both conformance suites run there and on `ubuntu-24.04-arm` on the same commit, and every page outcome is compared.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. The specs already require these behaviours: a page whose process aborts is `CRASH` (conformance-testing, Page outcome), and the ASan job uses the platform's pinned symbols archive (continuous-integration). This change makes Linux x64 meet them, so it sets `skip_specs`. If the diagnosis calls for a behaviour change, a delta is added then. The Linux x64 supported-platform and CI deltas stay with linux-arm64-focus task 4.6.

## Impact

- `angle/bundles.toml` (`symbols_url` and `symbols_sha256` for `linux-x64`), `.github/lsan-suppressions.txt` (the comment's "Linux arm64 only" becomes both Linux architectures, if the suppression matches there).
- The `TIMEOUT` fix, once diagnosed: most likely `conformance/pool.mjs` or the harness test.
- CI is unchanged here. Re-enabling the Linux x64 `PLATFORM-FOCUS` entries (including the x64 ASan step with `-Zbuild-std`) stays with linux-arm64-focus task 4.5.

## Out of Scope and Extension Points

- **Linux x64 conformance in CI.** The comparison runs once on a scratch branch; whether the conformance job gains other platforms is decided in linux-arm64-focus task 4.6.
- **GPU backends.** GitHub's runners have no GPU; only SwiftShader is tested.
