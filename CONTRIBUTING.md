# Contributing

Changes follow OpenSpec: a proposal in `openspec/changes/` is reviewed before
code is written. Run OpenSpec as `npx openspec`. See the README for
prerequisites and everyday commands.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request to `main` and every push
to `main`. A newer push to a pull request cancels its earlier run.

| Job | Runs on | Checks |
|---|---|---|
| `workflow-lint` | Linux | actionlint, and zizmor with `.github/zizmor.yml` (every action pinned to a commit SHA, minimal permissions, no template injection) |
| `check` | Linux arm64 | rustfmt, clippy (pedantic, warnings as errors), Rust tests, ESLint and tsc, native + TS build, Node tests with `OXGL_BACKEND=software` |
| `repo-checks` | Linux | the ANGLE pin check, dependency licenses and `THIRD_PARTY_NOTICES` |
| `node-range` | Linux arm64 | Node tests on Node 22.22.2 (the `engines` floor) and Node 26 |
| `asan` | Linux arm64 | Rust tests under AddressSanitizer and LeakSanitizer |
| `conformance` | Linux arm64 | both Khronos conformance suites with `OXGL_BACKEND=software`, judged against `conformance/expectations.txt`; each suite's report is uploaded as `conformance-results-<suite>` (see Conformance tests below) |
| `gpu` | self-hosted `oxgl-gpu` runner | Node tests on a real GPU; skipped unless the `OXGL_GPU_RUNNER` repository variable is `true` |
| `ci` | Linux | succeeds only when every job above except `gpu` succeeded |

Linux arm64 is the only supported platform for now (see the README), so the
jobs that build or test oxgl run only on `ubuntu-24.04-arm`. The other
platforms' entries stay in `ci.yml`, commented out; `grep -n PLATFORM-FOCUS
.github/workflows/ci.yml` lists them.

Branch protection on `main` should require the single `ci` check (Settings →
Branches → branch protection rule for `main` → Require status checks → `ci`).
Jobs can then be added or renamed without changing that setting.

`workflow-lint` and `repo-checks` run on every change. The jobs that build or
test oxgl (`check`, `node-range`, `asan`, `conformance`, `gpu`) are skipped
when every changed file is on the skip list in `ci.yml`'s `changes` job:
Markdown, `openspec/`, `.claude/`, `LICENSE`, `.editorconfig` and the
workflow linters' config. `ci` passes those skips and fails any other. Add a
path to the list only if no build, lint or test step reads it; anything not
listed, including a new directory, runs every job.

ANGLE is never built here: its recipe and bundle releases live in
[jerryryle/oxgl-angle](https://github.com/jerryryle/oxgl-angle) (see
`angle/README.md`). Every job uses the pinned bundle from
`angle/bundles.toml`, cached by the manifest's hash. `oxgl-sys/build.rs`
verifies the digest when it downloads the bundle; a restored cache entry is
used as-is.

Tool versions live in one place, `ci.yml`: the `env` block (license tools and
the ASan nightly, actionlint, zizmor). The commands below name them by those
`env` keys.
Dependabot bumps only the SHA-pinned actions, so bump these by hand.

## Reproducing a job locally

`check`:

```sh
npm ci
npm run lint:rust
npm run lint:js
cargo test --workspace --exclude oxgl-node --locked
npm run build
OXGL_BACKEND=software npm test
```

`repo-checks` (needs Python 3.11+ and the license tools at the versions in
`ci.yml`'s `env`):

```sh
python3 angle/scripts/check_pin.py
npm run lint:licenses
```

`workflow-lint` (needs Go and uv):

```sh
go install github.com/rhysd/actionlint/cmd/actionlint@<ACTIONLINT_VERSION>
"$(go env GOPATH)/bin/actionlint"
uvx zizmor@<ZIZMOR_VERSION> --config .github/zizmor.yml .github/workflows
```

`asan` (Linux arm64 only):

```sh
NIGHTLY=<ASAN_NIGHTLY>
rustup toolchain install "$NIGHTLY" --profile minimal
RUSTFLAGS="-Zsanitizer=address -Cforce-frame-pointers=yes" \
RUSTDOCFLAGS="-Zsanitizer=address -Cforce-frame-pointers=yes" \
ASAN_OPTIONS=detect_leaks=1:halt_on_error=1:detect_stack_use_after_return=1:fast_unwind_on_malloc=0 \
ASAN_SYMBOLIZER_PATH="$(command -v llvm-symbolizer)" \
OXGL_ANGLE_SYMBOLS=1 \
LSAN_OPTIONS="suppressions=$PWD/.github/lsan-suppressions.txt" \
cargo +"$NIGHTLY" test --workspace --exclude oxgl-node --locked \
  --target aarch64-unknown-linux-gnu
```

The arm64 job does not rebuild std with `-Zbuild-std`: on aarch64 that
instruments `compiler_builtins`, and every test binary then crashes inside
`__asan_init`.

`OXGL_ANGLE_SYMBOLS=1` builds the tests against the unstripped ANGLE libraries
from the pinned symbols archive, and `fast_unwind_on_malloc=0` lets the
unwinder follow ANGLE's signed return addresses, so suppressions can match
ANGLE-internal frames. Read the header of `.github/lsan-suppressions.txt`
before adding an entry: suppressions name one specific internal function,
never a library or an exported EGL/GL/Vulkan entry point.

## Conformance tests

`npm run conformance` runs the Khronos WebGL conformance suites against the
built package (`npm run build` first). The suite is `sdk/tests` of the
`KhronosGroup/WebGL` commit pinned in `conformance/suite.json`. The first run
fetches it into `.cache/conformance/`, and later runs reuse that copy until the
pin changes. Each page runs in jsdom in its own Node process, with
`canvas.getContext` returning oxgl contexts.

The runner needs the `canvas` devDependency, the local package in
`conformance/canvas/`. It presents `@napi-rs/canvas` (Skia, pinned exactly in
`package.json`) through the node-canvas API that jsdom expects. jsdom uses it
for 2D contexts and image decoding, and the runner exposes its `ImageData`
class to pages; many texture pages need these before they reach oxgl. `npm ci`
installs its prebuilt binary on every target, with no system libraries; the
runner stops with an error naming it if it cannot be loaded. It is a
devDependency only, so `npm install oxgl` never downloads it.

The WebGL constants in `src/generated/webgl-constants.ts` come from the IDL
files at the same commit. When you move the pin, regenerate them with `node
scripts/webgl-constants.mjs` and commit the result.

There are two suites. `webgl1` runs the 1.0.x test list with WebGL 1 contexts,
and `webgl2` runs the 2.0.x list, which includes `conformance/`, with WebGL 2
contexts. Every page gets one outcome: `PASS`, `FAIL`, `TIMEOUT` or `CRASH`.

`conformance/expectations.txt` lists every page that is not expected to pass,
one per line as `<suite> <path> <OUTCOME> # <reason>`. A run fails on any
difference: a page that regressed, a page that passes but is still listed, a
different failure than the one listed, or an entry for a page the suite no
longer has. A change that makes pages pass removes their entries. `SKIP`
entries are for pages confirmed to hang; they are not run.

An uncaught error ends a page at once only when its entry is `FAIL`. Every other
page keeps running after the error, as in the official harness, until it
completes or goes the time limit without a new result. Once the file is empty, every page is
judged as the official harness judges it.

Run CI's configuration (`OXGL_BACKEND=software`) when comparing with CI.
Results under SwiftShader on other platforms can differ from CI's on Linux
arm64.

```sh
OXGL_BACKEND=software npm run conformance                       # both suites
OXGL_BACKEND=software npm run conformance -- --suite webgl1     # one suite
OXGL_BACKEND=software npm run conformance -- --filter conformance/buffers/   # pages whose path contains this
OXGL_BACKEND=software npm run conformance -- --filter conformance/buffers/ --update   # rewrite their entries
```

Other options: `--include-skipped` runs `SKIP` pages and reports them without
judging them. `--fast-errors` ends every page at its first uncaught error, which
helps when exploring an area that oxgl does not implement yet. `--timeout
<seconds>` sets how long a page may go without a new result before it times
out (default 60; the official harness's watchdog is 20, but some pages report
only after draw loops that take longer than half of that on SwiftShader); each
result restarts the clock. `--jobs <n>` sets how many pages run at once (default: the number of
CPUs).

`--update` rewrites the entries of the pages that ran from their outcomes. It
keeps the reason of an entry whose outcome did not change, removes entries
for pages that now pass, and takes new reasons from the page's first failure
message. On a run without `--filter`, it also drops entries for pages the suite
no longer has. Review the diff, and replace generated reasons with better ones
where it helps. Moving a page to `SKIP` is a manual edit.

Every run writes `conformance-results.json` with each page's outcome, result
counts, duration and first failure message or error.
