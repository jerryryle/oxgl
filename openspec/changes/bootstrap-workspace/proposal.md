# Proposal

## Why

oxgl has no code structure yet. Every later change (ANGLE bindings, contexts, CI) needs the Cargo workspace, the three-crate split that confines `unsafe` to one crate, the lint gates that enforce the project safety rules, and a Node package that loads the native addon. Establishing these first means the safety rules are enforced by tooling from the first line of implementation code rather than retrofitted.

## What Changes

- Add a Cargo workspace at the repo root with three crates: `oxgl-sys` (FFI, the only crate permitted `unsafe`), `oxgl-core` (`#![forbid(unsafe_code)]`), and `oxgl-node` (napi-rs cdylib, `#![forbid(unsafe_code)]` with any napi-rs macro exemption scoped and justified).
- Add workspace-wide lint configuration: clippy pedantic plus the lints that mechanically enforce the safety rules (no `unwrap`/`expect`/`panic`/indexing panics outside tests, mandatory `// SAFETY:` comments, `unsafe_op_in_unsafe_fn`), with warnings as errors.
- Pin the Rust toolchain with `rust-toolchain.toml` and add `rustfmt` configuration.
- Extend the existing root `package.json` in place (keeping the `@fission-ai/openspec` devDependency and `private: true`) into the `oxgl` JS/TS package: napi-rs build scripts, TypeScript entry point and type declarations, ESLint configuration, and `node:test` test setup.
- The package entry point loads the native addon for the host platform and fails with a descriptive, coded error when no binary is available.

No WebGL API surface is added by this change.

## Capabilities

### New Capabilities
- `workspace`: Repository build and code-quality contract: crate layout, where `unsafe` may appear, lint gates, and the standard build, lint, and test commands for Rust and JS.
- `node-api`: The `oxgl` npm package's loading contract: how it resolves and loads the platform native addon and how it reports a missing or incompatible binary.
- `licensing`: oxgl's own license (BSD-3-Clause), the allowlist of licenses bundled dependencies may carry, and the third-party notices shipped with the package.

### Modified Capabilities

None.

## Impact

- New files: `Cargo.toml`, `rust-toolchain.toml`, `rustfmt.toml`, `clippy.toml`, `crates/oxgl-{sys,core,node}/`, `src/` (TS), `test/`, `tsconfig.json`, `eslint.config.js`, `.editorconfig`.
- `package.json` gains build/lint/test scripts, `engines`, `main`/`types`/`exports`, napi config, and devDependencies (`@napi-rs/cli`, `typescript`, `eslint`, `typescript-eslint`). Existing fields are preserved.
- Developers need a Rust toolchain (installed via rustup; the pinned version is picked up automatically).

## Out of Scope and Extension Points

- No ANGLE bindings or GL calls (`angle-acquisition`, `headless-context`). `oxgl-sys` is an empty, lint-configured crate ready to receive them.
- No CI workflows (`ci-pipeline`); this change only defines the commands CI will run.
- No WebIDL code generation. Type declarations are hand-written under `src/`, in a layout that a later generator can own wholesale (generated files go in a dedicated directory that the hand-written entry point re-exports).
- No publishing: the package stays `private: true`; per-platform binary package naming is left to a release change.
