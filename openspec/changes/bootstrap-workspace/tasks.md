# Tasks

## 1. Rust workspace

- [x] 1.1 Add `rust-toolchain.toml` pinned to the current stable release with `rustfmt` and `clippy` components; verify `rustup show` selects it in the repo
- [x] 1.2 Add virtual `Cargo.toml` (resolver 3, edition 2024, `[workspace.lints]` per design) plus `clippy.toml` and `rustfmt.toml`; verify `cargo metadata` lists the workspace
- [x] 1.3 Create `crates/oxgl-sys` (empty lib, `#![deny(unsafe_op_in_unsafe_fn)]`) and `crates/oxgl-core` (`#![forbid(unsafe_code)]`) with `[lints] workspace = true`; verify `cargo build --workspace` succeeds with zero warnings

## 2. Node binding crate

- [x] 2.1 Create `crates/oxgl-node` as a napi-rs v3 cdylib with `[lib] test = false` and `doctest = false` (its tests run under Node; Rust tests use `cargo test --workspace --exclude oxgl-node`), depending on `oxgl-core`, with `#![forbid(unsafe_code)]`, exporting no public API beyond what the loader needs to confirm the addon loaded; verify `cargo clippy --workspace --all-targets -- -D warnings` passes, or apply the scoped exemption from design.md and document it
- [x] 2.2 Verify dependency direction with `cargo tree` (sys depends on neither, core does not depend on node; node may depend on sys directly)

## 3. JS package

- [x] 3.1 Edit root `package.json` in place: add `engines`, `exports`/`main`/`types`, napi config, scripts (`build`, `build:native`, `build:ts`, `lint`, `test`), and exactly pinned devDependencies; keep `private`, the `openspec` script, and the OpenSpec devDependency; verify `npx openspec --version` still prints 1.15.0
- [x] 3.2 Add `tsconfig.json`, `src/index.ts`, the native loader wrapper raising `OXGL_NATIVE_MISSING`, and `src/generated/README.md` (ESM-only output); verify `npm run build` produces `dist/` and the `.node` addon
- [x] 3.3 Add `eslint.config.js` and `.editorconfig`; extend `.gitignore` with `dist/` and `*.node`; verify `npm run lint` passes and fails when a deliberate ESLint error is introduced
- [x] 3.4 Add `test/load.test.mjs` covering ESM import, CJS require, and the `OXGL_NATIVE_MISSING` path (by pointing the loader at a nonexistent binary via a test-only override); verify `npm test` passes

## 4. Licensing

- [x] 4.1 Add `LICENSE` (BSD-3-Clause, "Copyright (c) 2026, Jerry Ryle") and set `license = "BSD-3-Clause"` in `package.json` and every crate; verify `cargo metadata` and `npm pkg get license` report it
- [x] 4.2 Add `deny.toml` with the license allowlist and wire `cargo deny check licenses` into `npm run lint`; check how the pinned cargo-deny version handles build-dependencies, and if it can't skip them, add commented per-crate exceptions for build-only crates; verify adding a GPL-only crate to `oxgl-core` fails the check while the build-script crates pass
- [x] 4.3 Add `cargo-about` configuration and a script that writes `THIRD_PARTY_NOTICES` (Rust crates now; ANGLE `licenses/` once `angle-acquisition` lands), included in `package.json` `files`; verify `npm pack --dry-run` lists `LICENSE` and `THIRD_PARTY_NOTICES`, and that `npm run lint` fails when the notices are stale

## 5. Documentation

- [x] 5.1 Add a README section on prerequisites (rustup, Node range) and the build/lint/test commands; verify each documented command runs as written on a clean clone
