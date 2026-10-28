# oxgl

Standards-compliant WebGL 1 and WebGL 2 for Node.js, rendered headless through
ANGLE, with a SwiftShader software fallback. Early development: the package
currently only loads its native addon.

## Prerequisites

- [rustup](https://rustup.rs). The pinned toolchain in `rust-toolchain.toml` is
  installed automatically on first use.
- Node.js 22.12.0 or newer (`engines` in `package.json`). Development tooling
  needs Node 22.13.0 or newer.
- Python 3.11 or newer (`python3`; `python` on Windows): `npm run build`
  re-checks the ANGLE bundle's licenses with `angle/scripts/bundle.py`.
- For the license check: `cargo install --locked cargo-deny@0.20.2` and
  `cargo install --locked cargo-about@0.9.3 --features cli`.

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

## License

BSD-3-Clause; see `LICENSE`. Bundled third-party components and their licenses
are listed in `THIRD_PARTY_NOTICES`.
