# oxgl

Standards-compliant WebGL 1 and WebGL 2 for Node.js, rendered headless through
ANGLE, with a SwiftShader software fallback. Early development: the package
currently only loads its native addon.

## Prerequisites

- [rustup](https://rustup.rs). The pinned toolchain in `rust-toolchain.toml` is
  installed automatically on first use.
- Node.js 22.12.0 or newer (`engines` in `package.json`). Development tooling
  needs Node 22.13.0 or newer.
- For the license check: cargo-deny and cargo-about at the versions CI pins
  (`CARGO_DENY_VERSION` and `CARGO_ABOUT_VERSION` in
  `.github/workflows/ci.yml`), installed with
  `cargo install --locked cargo-deny@<version>` and
  `cargo install --locked cargo-about@<version> --features cli`.

## Commands

```sh
npm install        # install JS tooling
npm run build      # build the native addon (release) and the TypeScript package into dist/
npm run lint       # rustfmt, clippy (pedantic, warnings as errors), ESLint, tsc, license check
npm test           # node:test suites in test/ (run after build)
npm run notices    # regenerate THIRD_PARTY_NOTICES after changing Rust dependencies
cargo test --workspace --exclude oxgl-node   # Rust tests (oxgl-node is tested from Node)
```

Specs and change proposals live in `openspec/`; run OpenSpec as `npx openspec`.
`CONTRIBUTING.md` describes the CI checks and how to run each one locally.

## License

BSD-3-Clause; see `LICENSE`. Bundled third-party components and their licenses
are listed in `THIRD_PARTY_NOTICES`.
