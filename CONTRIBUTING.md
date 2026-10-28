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
| `check` | Linux x64, macOS arm64, Windows x64 | rustfmt, clippy (pedantic, warnings as errors), Rust tests, ESLint and tsc, native + TS build, Node tests with `OXGL_BACKEND=software` |
| `repo-checks` | Linux | the ANGLE pin check, dependency licenses and `THIRD_PARTY_NOTICES` |
| `node-range` | Linux | Node tests on Node 22.12.0 (the `engines` floor) and Node 26 |
| `asan` | Linux x64 | Rust tests under AddressSanitizer and LeakSanitizer |
| `gpu` | self-hosted `oxgl-gpu` runner | Node tests on a real GPU; skipped unless the `OXGL_GPU_RUNNER` repository variable is `true` |
| `ci` | Linux | succeeds only when every job above except `gpu` succeeded |

Branch protection on `main` should require the single `ci` check (Settings →
Branches → branch protection rule for `main` → Require status checks → `ci`).
Jobs can then be added or renamed without changing that setting.

ANGLE is never built here: every job uses the pinned bundle from
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
python3 angle/scripts/check_pin.py --allow-unpublished
npm run lint:licenses
```

`workflow-lint` (needs Go and uv):

```sh
go install github.com/rhysd/actionlint/cmd/actionlint@<ACTIONLINT_VERSION>
"$(go env GOPATH)/bin/actionlint"
uvx zizmor@<ZIZMOR_VERSION> --config .github/zizmor.yml .github/workflows
```

`asan` (Linux x64 only):

```sh
NIGHTLY=<ASAN_NIGHTLY>
rustup toolchain install "$NIGHTLY" --profile minimal --component rust-src
RUSTFLAGS="-Zsanitizer=address -Cforce-frame-pointers=yes" \
RUSTDOCFLAGS="-Zsanitizer=address -Cforce-frame-pointers=yes" \
ASAN_OPTIONS=detect_leaks=1:halt_on_error=1:detect_stack_use_after_return=1 \
LSAN_OPTIONS="suppressions=$PWD/.github/lsan-suppressions.txt" \
cargo +"$NIGHTLY" test --workspace --exclude oxgl-node --locked \
  -Zbuild-std --target x86_64-unknown-linux-gnu
```

`.github/lsan-suppressions.txt` starts empty. Read its header before adding an
entry: suppressions name one specific internal function, never a library or an
exported EGL/GL/Vulkan entry point.
<!-- throwaway -->
