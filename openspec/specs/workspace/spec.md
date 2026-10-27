# workspace Specification

## Purpose
Defines the repository's build and code-quality contract: how the Rust workspace and JS package are laid out, where `unsafe` code may appear, which lint gates every change must pass, and the commands that build, lint, and test the project.

## Requirements

### Requirement: Three-crate Rust workspace
The repository SHALL contain a Cargo workspace whose members are exactly `oxgl-sys`, `oxgl-core`, and `oxgl-node`, with dependencies flowing only `oxgl-node` → `oxgl-core` → `oxgl-sys`, plus a direct `oxgl-node` → `oxgl-sys` dependency (for oxgl-sys's Node-API FFI). The toolchain version SHALL be pinned in the repository so every developer and CI job builds with the same compiler.

#### Scenario: Workspace builds from a clean checkout
- **WHEN** a developer with rustup installed runs `cargo build --workspace` in a fresh clone
- **THEN** the pinned toolchain is used and all three crates build without errors or warnings

#### Scenario: Dependency direction is enforced
- **WHEN** `cargo metadata` is inspected
- **THEN** `oxgl-sys` depends on neither other crate and `oxgl-core` does not depend on `oxgl-node`

### Requirement: Unsafe code is confined to oxgl-sys
Only `oxgl-sys` SHALL contain `unsafe` code. `oxgl-core` SHALL declare `#![forbid(unsafe_code)]`. `oxgl-node` SHALL declare `#![forbid(unsafe_code)]`, except that an exemption required by napi-rs-generated code MAY be granted at the narrowest possible scope with a comment explaining why it is needed.

#### Scenario: Unsafe in oxgl-core is rejected
- **WHEN** an `unsafe` block is added anywhere in `oxgl-core`
- **THEN** `cargo build` fails with a `forbid(unsafe_code)` error

#### Scenario: Unsafe in oxgl-node outside an exemption is rejected
- **WHEN** an `unsafe` block is added to `oxgl-node` outside a documented napi-rs exemption
- **THEN** `cargo build` fails

### Requirement: Unsafe code is documented and explicit
Every `unsafe` block SHALL be preceded by a `// SAFETY:` comment, and the workspace SHALL deny `unsafe_op_in_unsafe_fn` so that unsafe operations inside `unsafe fn` still require an explicit, commented `unsafe` block.

#### Scenario: Missing SAFETY comment fails lint
- **WHEN** an `unsafe` block in `oxgl-sys` lacks a `// SAFETY:` comment
- **THEN** `cargo clippy --workspace --all-targets` fails

#### Scenario: Implicit unsafe operation fails build
- **WHEN** an `unsafe fn` performs an unsafe operation without an inner `unsafe` block
- **THEN** compilation fails due to `unsafe_op_in_unsafe_fn`

### Requirement: No panicking constructs in non-test code
Non-test code SHALL NOT use `unwrap`, `expect`, `panic!`, `todo!`, `unimplemented!`, `unreachable!`, or panicking slice indexing; these SHALL be rejected by lint. Test code MAY use them.

#### Scenario: unwrap in library code fails lint
- **WHEN** `Option::unwrap` is called in non-test code of any crate
- **THEN** `cargo clippy --workspace --all-targets` fails

#### Scenario: unwrap in tests is allowed
- **WHEN** a `#[test]` function calls `unwrap`
- **THEN** clippy reports no error for that call

### Requirement: Pedantic lints with warnings as errors
The workspace SHALL enable clippy's `pedantic` group, and the standard lint command SHALL treat every warning as an error. Any per-item lint allowance SHALL carry a justification comment.

#### Scenario: Pedantic warning fails the lint command
- **WHEN** code triggers any clippy pedantic lint
- **THEN** the standard lint command exits non-zero

### Requirement: Standard project commands
The root `package.json` SHALL expose scripts that build the native addon and JS package, lint Rust and JS sources (format check, clippy, ESLint, TypeScript type check), and run the Node test suite with `node:test`. Each script SHALL exit non-zero on any failure.

#### Scenario: Lint script covers both languages
- **WHEN** a developer runs `npm run lint`
- **THEN** rustfmt check, clippy, ESLint, and the TypeScript type check all run, and the command fails if any of them fails

#### Scenario: Test script runs node:test
- **WHEN** a developer runs `npm test` after `npm run build`
- **THEN** the Node test files run under the built-in `node:test` runner and the command exits non-zero if any test fails

### Requirement: OpenSpec tooling is preserved
The root `package.json` SHALL keep `@fission-ai/openspec` as an exactly pinned devDependency and keep the `openspec` script, so that `npx openspec` resolves to the project-local version.

#### Scenario: Local OpenSpec still resolves
- **WHEN** `npx openspec --version` is run after this change
- **THEN** it prints the version pinned in `package.json`
