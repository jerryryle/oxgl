# Design

## Context

The repo currently holds only the OpenSpec setup: a root `package.json` (`name: oxgl`, `private: true`, OpenSpec devDependency, `openspec` script), `.gitignore`, and `openspec/`. See proposal.md for motivation. The safety rules in `openspec/config.yaml` are the main design driver: as many of them as possible should be enforced by the compiler and linters rather than by review.

## Goals / Non-Goals

**Goals:**
- Make violations of the safety rules fail the build or lint, not just code review.
- Settle the JS package layout so later changes (and a future WebIDL generator) add files without restructuring.

**Non-Goals:**
- Any GL or EGL code, any runtime behavior beyond loading the addon.
- Release packaging (per-platform npm packages, signing, provenance).

## Decisions

### Layout

```
Cargo.toml                 virtual workspace manifest (resolver = "3", edition 2024)
rust-toolchain.toml        pinned stable toolchain + rustfmt, clippy components
clippy.toml                test-code allowances
rustfmt.toml
crates/oxgl-sys/           lib (rlib)  — FFI; empty in this change
crates/oxgl-core/          lib (rlib)  — #![forbid(unsafe_code)]
crates/oxgl-node/          cdylib      — napi-rs; #![forbid(unsafe_code)]
src/                       TypeScript package sources
src/generated/             reserved for future WebIDL output (empty + README)
dist/                      tsc output (gitignored)
test/                      node:test files (*.test.mjs)
```

Crates live under `crates/` so the root stays the npm package root, which napi-rs and npm both expect.

### Lint enforcement via `[workspace.lints]`

Each crate sets `[lints] workspace = true`. The workspace table sets:

- `rust`: `unsafe_op_in_unsafe_fn = "deny"`, `missing_docs = "warn"` (on public items).
- `clippy`: `pedantic = { level = "warn", priority = -1 }`, and `deny` for `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented`, `unreachable`, `indexing_slicing`, `undocumented_unsafe_blocks`, `multiple_unsafe_ops_per_block`.
- `clippy.toml`: `allow-unwrap-in-tests`, `allow-expect-in-tests`, `allow-panic-in-tests`, `allow-indexing-slicing-in-tests` all `true`.

`forbid(unsafe_code)` is a crate attribute in `oxgl-core` and `oxgl-node` rather than a workspace lint, because a workspace-level `forbid` cannot be relaxed for `oxgl-sys`. The lint command is `cargo clippy --workspace --all-targets --locked -- -D warnings`, which turns pedantic warnings into errors in CI while keeping local `cargo build` usable mid-edit.

`undocumented_unsafe_blocks` is what mechanically enforces the `// SAFETY:` rule.

*Alternative considered:* `#![deny(clippy::pedantic)]` in each `lib.rs`. Rejected: duplicated across crates and easy to drift; the workspace table is a single source of truth.

### napi-rs and the oxgl-node unsafe exemption

`oxgl-node` uses napi-rs v3 (`napi`, `napi-derive`, `napi-build`). The `#[napi]` macro expands to `unsafe` FFI glue. Lints on macro-expanded code from an external proc-macro are normally not reported against the user crate, so `#![forbid(unsafe_code)]` is expected to hold. If a specific napi-rs version does trip it, the fallback is `#![deny(unsafe_code)]` with `#[allow(unsafe_code)]` on the single generated item plus a justification comment, as the spec permits. The first implementation task verifies which case applies.

### Panic strategy

Release profile keeps `panic = "unwind"`. Lints already forbid panicking constructs; unwinding is the last line of defence, because napi-rs wraps exported functions in `catch_unwind` and converts a stray panic into a JS exception instead of aborting the user's Node process. Any `extern "C"` callback registered with ANGLE later (`oxgl-sys`) must catch unwinds itself, which is noted for the headless-context design.

### JS package

- Sources in TypeScript under `src/`, compiled by `tsc` to `dist/` as ESM with `.d.ts`. The package is ESM-only with no top-level await, so `require('oxgl')` works through Node's `require(esm)`, which is unflagged from the 22.12 floor. Having no separate CommonJS entry avoids loading two copies of the classes. `package.json` `exports` maps `types` and `default`. Accepted trade-off: Node 22.12 can print an `ExperimentalWarning` for `require(esm)`. Per the 22.12 release notes, the warning is skipped when the `require()` comes from a path containing `node_modules`, so users who install the package don't see it. Only requires from outside `node_modules` (such as this repo's own tests) can show it.
- The native loader is the napi-rs CLI-generated loader (platform/arch → `.node` file). It is CommonJS, so it is emitted as `native.cjs` and loaded from the ESM entry with `createRequire(import.meta.url)`; ESM can't import a `.node` file directly. It is wrapped so any load failure is rethrown as `Error` with `code: 'OXGL_NATIVE_MISSING'` and the original error as `cause`.
- Tests are plain ESM `*.test.mjs` run by `node --test`, importing the built package, so they exercise the same entry point users get.
- ESLint flat config with `typescript-eslint` strict-type-checked; `tsc --noEmit` as type check. No Prettier, to keep the toolchain small; ESLint stylistic rules are off.

### Node version range

`engines.node: ">=22.12.0"`. Node 20 reached end-of-life in April 2026; 22.12 is the first 22.x with unflagged `require(esm)`. The addon targets N-API version 9, which every Node in that range provides.

### package.json edits

The existing file is edited in place: `private: true`, `name`, the `openspec` script, and the pinned `@fission-ai/openspec` devDependency are kept untouched. New devDependencies are pinned exactly, matching the OpenSpec convention.

### Licensing

The project license is **BSD-3-Clause**. It matches ANGLE, the core dependency, and every component expected in the bundle is permissive:

| Component | License |
|---|---|
| ANGLE (and Chromium `base`-derived code it builds) | BSD-3-Clause |
| SwiftShader, Vulkan loader, SPIRV-Tools, abseil | Apache-2.0 |
| LLVM / Subzero inside SwiftShader, Chromium's bundled libc++ | Apache-2.0 WITH LLVM-exception |
| zlib, xxhash | Zlib, BSD-2-Clause |
| Rust crates: napi-rs, libloading, slotmap and the Rust standard library | MIT, ISC, Zlib, MIT OR Apache-2.0 |

Apache-2.0 code can be distributed inside a BSD-3-Clause package as long as its own terms are met: its license text and any `NOTICE` contents travel with the binaries. BSD-3-Clause, MIT, ISC and Zlib all require their notices in binary distributions too. So the licensing work is mostly distribution, not compatibility. The exact ANGLE component list is confirmed against the pinned revision in `angle-acquisition`.

*Alternative considered:* Apache-2.0 for oxgl itself (an explicit patent grant, and the license of most of the bundled bytes). Not chosen: BSD-3-Clause is your stated preference, matches ANGLE and Chromium, and nothing bundled requires otherwise.

Mechanics:
- `cargo-deny` (`deny.toml`) enforces the allowlist. Its graph options exclude dev-dependencies but may not exclude build-dependencies, and the build-script crates (HTTP/TLS, digest, archive, bindgen) don't ship. Task 4.2 checks how the pinned cargo-deny version handles build-dependencies. If it can't skip them, build-only crates whose license isn't allowlisted get explicit per-crate `[[licenses.exceptions]]` entries, each commented "build-time only, not distributed". Build-script crates whose licenses are already allowlisted are preferred (e.g. a TLS setup using the OS certificate store instead of a bundled roots crate).
- `cargo-about` generates the Rust half of `THIRD_PARTY_NOTICES`. The ANGLE half is concatenated from the bundle's `licenses/` directory, and `npm run build` produces the combined file. `npm run lint` regenerates it and fails if it differs from the committed copy.
- `package.json` `files` includes `LICENSE` and `THIRD_PARTY_NOTICES`. Future per-platform binary packages repeat both files, since the bundled code is in them.

## Safety Rules

- *Unsafe confinement:* enforced by `forbid(unsafe_code)` in two crates and `undocumented_unsafe_blocks` + `unsafe_op_in_unsafe_fn` in the third.
- *No panics:* enforced by clippy denies with test-only allowances.
- *Handle model, ArrayBuffer lifetime:* not exercised; no handles or buffers exist yet.

## Risks / Trade-offs

- [`indexing_slicing` makes ordinary code verbose] → Accept; use `get()`/iterators. It closes the largest remaining panic source.
- [napi-rs macro expansion trips `forbid(unsafe_code)`] → Documented, scoped fallback above; verified in task 2.
- [Pedantic churn on toolchain upgrades] → Toolchain is pinned; upgrades are a deliberate change that fixes new lints in the same commit.

## Open Questions

None.
