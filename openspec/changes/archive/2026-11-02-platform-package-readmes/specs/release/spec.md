## ADDED Requirements

### Requirement: Platform packages point to the main package
Each platform package SHALL include a `README.md`, so that its npmjs.com page says what it is and points to `@oxgl-js/oxgl`. Every such README SHALL be filled in, when the package is packed, from one checked-in template, `scripts/platform-README.md`, in which only the package name and the platform's label vary.

#### Scenario: README in the tarball
- **WHEN** the `@oxgl-js/linux-arm64-gnu` tarball produced by `scripts/pack.mjs` is listed
- **THEN** it contains `README.md`, which is `scripts/platform-README.md` with the package name `@oxgl-js/linux-arm64-gnu` and the label `Linux arm64 (glibc)` filled in

#### Scenario: Template missing a placeholder
- **WHEN** `scripts/platform-README.md` lacks the `{{platform}}` placeholder and `scripts/pack.mjs` runs
- **THEN** the pack fails, naming the missing placeholder, and writes no tarball

#### Scenario: Template with an unknown placeholder
- **WHEN** `scripts/platform-README.md` contains `{{version}}` and `scripts/pack.mjs` runs
- **THEN** the pack fails, naming `{{version}}`, and writes no tarball
