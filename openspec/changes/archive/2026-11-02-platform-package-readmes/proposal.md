# Proposal

## Why

The five platform packages (`@oxgl-js/linux-x64-gnu` and the others) are published with no README, so their npmjs.com pages are empty. Someone who finds one there, or in a lockfile, can't tell what it is, and may install it directly, which gives them a native addon with no JavaScript API.

## What Changes

- **One checked-in README template for all platform packages.** A new `scripts/platform-README.md` holds the README's text, with two placeholders: `{{package}}` for the package name and `{{platform}}` for the platform's label. Everything else, the links included, is literal, so reading the template shows exactly what every package's README says. The template:

  ```markdown
  # {{package}}

  The native addon and ANGLE libraries of [oxgl](https://www.npmjs.com/package/@oxgl-js/oxgl)
  for {{platform}}. Don't install this package directly: install
  `@oxgl-js/oxgl`, which depends on it and loads it on this platform.

      npm install @oxgl-js/oxgl

  Documentation, source and issues: https://github.com/jerryryle/oxgl.
  Licensed BSD-3-Clause; the licenses of bundled third-party code are in
  `THIRD_PARTY_NOTICES`.
  ```

- **`scripts/pack.mjs` fills it in.** It writes the filled template as the staged platform package's `README.md`, beside the manifest it already generates and from the same target data. The labels are `Linux x64 (glibc)`, `Linux arm64 (glibc)`, `macOS arm64`, `Windows x64` and `Windows arm64`. A placeholder missing from the template fails the pack, as a missing marker fails the results page (`scripts/results-page.mjs`), and so does any `{{` left after filling in, such as a misspelled or unknown placeholder. The manifest's `files` is unchanged, since npm always packs a root `README.md`.
- **CI still builds when only the template changes.** The `changes` job's skip list matches `*.md`, which would take in the template, though `pack.mjs` reads it (continuous-integration, "Skip list holds only unread files"). A case ahead of `*.md` runs every job for it, and `CONTRIBUTING.md` says so.

### Out of scope

- `@oxgl-js/oxgl` already ships the repository's `README.md` and is unchanged.
- No version bump. Published versions can't change, so the READMEs reach npm with the next version the user releases.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `release`: a new requirement that every platform package includes a README, filled in from one checked-in template, that points to `@oxgl-js/oxgl`.

## Impact

- `scripts/pack.mjs` and the new `scripts/platform-README.md`.
- `.github/workflows/ci.yml` and `CONTRIBUTING.md`: the template is kept off the skip list. The smoke test and release are unchanged.
