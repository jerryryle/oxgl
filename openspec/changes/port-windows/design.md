# Design

## Context

The survey's only Windows failures are in the conformance harness's own tests, on both Windows architectures. Two causes:

- `conformance/pool.mjs` classifies a page process that exits by itself with a non-zero code as a native abort only for code 3 (the C runtime's `abort()`) or an `0xC…` NTSTATUS. Node's `process.abort()` on Windows runs `ABORT()`, which ends in `_exit(ExitCode::kAbort)`, 134 (`src/util.h` and `src/node_exit_code.h` at Node v24.11.1). The `abort.html` fixture calls `process.abort()`, so it reaches the last branch and becomes a harness error. `abort-at-teardown.html` aborts the same way; its failure was hidden because the test stops at the first failed assertion.
- The repository has no `.gitattributes`, so Git for Windows' default `core.autocrlf=true` checks text files out with CRLF.

## Goals / Non-Goals

**Goals:**
- Build and test green on Windows x64 and Windows arm64.
- A per-page conformance comparison with Linux arm64 on each Windows platform.

**Non-Goals:**
- Re-enabling Windows in CI (linux-arm64-focus 4.5).
- Testing the D3D11 GPU backend.

## Decisions

- **Treat exit code 134 as an abort on Windows.** It is the code Node itself uses for an abort, so a Node abort and a native one (code 3 or an NTSTATUS, for example from ANGLE or the addon) are both `CRASH`. Alternative: inspect stderr for Node's backtrace. Rejected: fragile, and the exit code is already the runner's signal. A page that calls `process.exit(134)` would also count as a crash; no conformance page can call `process.exit`, so the overlap is harmless. The rule stays Windows-only, since on POSIX an abort arrives as `SIGABRT`.
- **Repository-wide `* text=auto eol=lf`** instead of an exception for one fixture. Every text file then has the same bytes on every host: fixtures, the expectations file, and sources that formatters and linters check. Git detects binary files (PNG, JPEG, the ANGLE archives are not tracked), so they are untouched. A `-text` rule for `served.txt` alone would fix the one test and leave the next fixture to fail the same way.
- **Survey on a scratch branch, as in linux-arm64-focus 4.2.** A workflow of its own, never merged, that does not run the regular CI: build and test on `windows-2025` and `windows-11-arm` until green, then both conformance suites on each Windows runner and on `ubuntu-24.04-arm` in the same run, so every comparison is between outcomes on one commit. ffmpeg is installed on the Windows runners for the video pages. When port-windows and port-linux-x64 are applied together, one scratch workflow with a platform matrix serves both, with one Linux arm64 reference leg.
- **Runner speed is ruled out before a difference is attributed.** Before attributing a difference, re-run each differing page alone (`--jobs 1`) with a long limit (`--timeout 120`) on the same runner: a page that then passes is slow on that runner, not different, as with the macOS comparison (linux-arm64-focus task 4.3). Record those pages too, with their longest gap at the default settings and alone, for the CI decision in linux-arm64-focus task 4.6. GitHub's Windows arm64 runners are likely the slowest of the set.
- **Conformance differences are fixed or agreed, not silently accepted.** A Windows-only difference that is an oxgl bug is fixed in this change (added to tasks and reviewed first). One caused by ANGLE or SwiftShader on Windows is recorded with its cause for the user to agree, and how such platform-specific expectations are stored is proposed then, because the expectations file has no platform field today.

## Risks / Trade-offs

- [Renormalizing line endings touches files committed with CRLF] → `git add --renormalize .` shows any such file in the same commit; if none exist, the commit only adds `.gitattributes`.
- Safety rules: no native code changes. The runner and test changes are JavaScript and touch no `unsafe` code, handles or ArrayBuffer lifetimes.

## Accepted trade-offs

- A page process that exits with code 134 for a reason other than an abort is reported as `CRASH` on Windows. Conformance pages cannot call `process.exit`, so this does not happen in practice.
