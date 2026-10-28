# Spec Delta

## Purpose

Defines oxgl's own license, which licenses the code bundled into the package may carry, and how the license notices of everything bundled are distributed with the package.

## ADDED Requirements

### Requirement: Project license
oxgl SHALL be licensed under BSD-3-Clause. The repository root SHALL contain the license text in `LICENSE`. The npm package's `license` field and every crate's `license` field SHALL be `BSD-3-Clause`.

#### Scenario: License declared consistently
- **WHEN** `package.json` and each crate's `Cargo.toml` are read
- **THEN** each declares `BSD-3-Clause`, and `LICENSE` contains the BSD 3-Clause text naming Jerry Ryle as copyright holder

### Requirement: Bundled dependency licenses are compatible
Every dependency compiled, linked, or copied into a distributed artifact (the native addon, the JS package, the ANGLE bundle) SHALL carry a license on the project's allowlist: `BSD-3-Clause`, `BSD-2-Clause`, `MIT`, `ISC`, `Zlib`, `Apache-2.0`, `Apache-2.0 WITH LLVM-exception`, `BSL-1.0`, `Unicode-3.0`, `NCSA`, or `Spencer-94`. Any other license, including any copyleft license, SHALL fail the build's license check until the allowlist is changed in a reviewed change.

#### Scenario: Copyleft crate rejected
- **WHEN** a dependency licensed only under `GPL-3.0` or `LGPL-2.1` is added to a crate that ships in the addon
- **THEN** the license check fails and names the crate and its license

#### Scenario: Build-only dependency not counted
- **WHEN** a dependency is used only at build time (for example a code generator) and none of its code ends up in a distributed artifact
- **THEN** the license check does not require it to be on the allowlist

### Requirement: Third-party notices ship with the package
The distributed package SHALL include `LICENSE` and a `THIRD_PARTY_NOTICES` file holding the full license text, copyright notices, and any `NOTICE` file contents (as Apache-2.0 requires) of every bundled dependency, both Rust crates and ANGLE bundle components. The file SHALL be generated from the dependency graph, not maintained by hand.

#### Scenario: Notices present in the package
- **WHEN** the package tarball produced by `npm pack` is listed
- **THEN** it contains `LICENSE` and `THIRD_PARTY_NOTICES`, and the latter names every crate compiled into the addon and every component in the ANGLE bundle's license directory

#### Scenario: Notices stay current
- **WHEN** a bundled dependency is added or upgraded and the notices file is not regenerated
- **THEN** the license check fails
