# Spec Delta

## MODIFIED Requirements

### Requirement: Third-party notices ship with the package
Every distributed package SHALL include `LICENSE`. Each platform package SHALL also include a `THIRD_PARTY_NOTICES` file holding the full license text, copyright notices, and any `NOTICE` file contents (as Apache-2.0 requires) of every dependency bundled into it, both the Rust crates compiled into its addon and the components of its ANGLE bundle. The file SHALL be generated from the dependency graph, not maintained by hand.

#### Scenario: Notices present in the package
- **WHEN** the tarball of any platform package produced by `npm pack` is listed
- **THEN** it contains `LICENSE` and `THIRD_PARTY_NOTICES`, and the latter names every crate compiled into the addon and every component in that platform's ANGLE bundle license directory

#### Scenario: Main package carries the license
- **WHEN** the `@oxgl-js/oxgl` package tarball produced by `npm pack` is listed
- **THEN** it contains `LICENSE`, and no native addon or ANGLE library

#### Scenario: Notices stay current
- **WHEN** a bundled dependency is added or upgraded and the notices file is not regenerated
- **THEN** the license check fails
