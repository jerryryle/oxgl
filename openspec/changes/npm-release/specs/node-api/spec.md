# Spec Delta

## ADDED Requirements

### Requirement: Installs from npm without building
On a supported host, `npm install oxgl` SHALL install a working package without a Rust toolchain, a C compiler, install scripts or any download beyond the npm registry. The host's platform package SHALL provide the native addon and its ANGLE libraries, and the package SHALL load ANGLE from that platform package.

#### Scenario: Fresh install renders
- **WHEN** `npm install oxgl` runs in an empty project on Linux arm64 (glibc) with no Rust toolchain, and the project creates a context with `backend: 'software'`, clears it and reads back the pixels
- **THEN** the install runs no install scripts, `@oxgl-js/linux-arm64-gnu` is the only platform package installed, and the pixels read back are the clear color

#### Scenario: Local build takes precedence
- **WHEN** a developer runs `npm run build` in the repository and imports the package from `dist/`
- **THEN** the addon and ANGLE libraries built into `dist/` are loaded, not a platform package from `node_modules`

### Requirement: Unsupported host fails at import, not install
On a host with no matching platform package, such as Linux with musl, `npm install oxgl` SHALL succeed. Importing the package SHALL then throw the error defined in "Missing native addon is reported clearly", and that error's message SHALL name the platform package the host would need, or state that the host has none.

#### Scenario: musl host
- **WHEN** `npm install oxgl` runs on Alpine Linux arm64 and the package is then imported
- **THEN** the install succeeds without installing a platform package, and the import throws an `Error` with `code === 'OXGL_NATIVE_MISSING'` whose message names `linux`, `arm64` and the lack of a musl build

#### Scenario: Architecture with no build
- **WHEN** the package is installed and imported on 32-bit x86 Linux with glibc
- **THEN** the import throws an `Error` with `code === 'OXGL_NATIVE_MISSING'` whose message says there is no build for `linux-ia32`, and names no package to install

#### Scenario: Optional dependencies omitted
- **WHEN** `npm install --omit=optional oxgl` runs on Linux x64 and the package is then imported
- **THEN** the import throws an `Error` with `code === 'OXGL_NATIVE_MISSING'` whose message names `@oxgl-js/linux-x64-gnu`
