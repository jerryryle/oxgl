# node-api Specification

## Purpose
Defines the contract of the `oxgl` npm package as a Node module: how it is imported, how it locates and loads the native addon for the host platform, and how loading failures are reported to callers.

## Requirements

### Requirement: Package entry point
The package SHALL be importable as `@oxgl-js/oxgl` from both ES modules (`import`) and CommonJS (`require`) on supported Node versions, and SHALL ship TypeScript declarations for every export.

#### Scenario: ESM import succeeds
- **WHEN** a supported platform's Node process runs `import * as oxgl from '@oxgl-js/oxgl'`
- **THEN** the import resolves without error

#### Scenario: CommonJS require succeeds
- **WHEN** a supported platform's Node process runs `require('@oxgl-js/oxgl')`
- **THEN** the call returns the same exports as the ESM import

### Requirement: Native addon loading
On import, the package SHALL load the native addon built for the host platform and architecture through N-API, so a single binary works across all supported Node versions. The supported hosts are Linux x64 and Linux arm64 (glibc), macOS arm64, Windows x64 and Windows arm64, each with a pinned ANGLE bundle.

#### Scenario: Addon loads on a supported platform
- **WHEN** the package is imported on any supported host after `npm run build`
- **THEN** the native addon is loaded and the package reports no error

#### Scenario: Software rendering on Linux arm64
- **WHEN** the package is built and imported on Linux arm64, or any other supported host, with no GPU
- **THEN** the addon loads, and a context created with `backend: 'software'` clears and reads back pixels correctly

#### Scenario: Local build on an unsupported host
- **WHEN** a developer runs `npm run build` on a host with no pinned ANGLE bundle, such as Linux arm64 with musl
- **THEN** the build fails with an error naming the target that has no ANGLE bundle

### Requirement: Missing native addon is reported clearly
If no native addon is available for the host platform, or the addon fails to load, importing the package SHALL throw an `Error` whose `code` is `OXGL_NATIVE_MISSING` and whose message names the host platform, the architecture, and the underlying load error.

#### Scenario: Unsupported platform
- **WHEN** the package is imported on a platform/architecture with no built addon
- **THEN** an `Error` with `code === 'OXGL_NATIVE_MISSING'` is thrown and its message names the platform and architecture

### Requirement: Supported Node versions are declared
The package SHALL declare its supported Node versions in `engines.node`, and that range SHALL match the Node versions exercised by the project's test suite.

#### Scenario: engines field present
- **WHEN** `package.json` is read
- **THEN** `engines.node` is set to the supported range

### Requirement: Results in the caller's realm
Arrays that WebGL calls return SHALL be created by the JS layer, so that in a page realm (such as the conformance runner's) their constructor is that realm's `Array`.

#### Scenario: Color write mask in a page
- **WHEN** a page compares `getParameter(COLOR_WRITEMASK).constructor` with its own `Array`
- **THEN** they are the same (cf. deqp `booleanstatequery`)

### Requirement: Installs from npm without building
On a supported host, `npm install @oxgl-js/oxgl` SHALL install a working package without a Rust toolchain, a C compiler, install scripts or any download beyond the npm registry. The host's platform package SHALL provide the native addon and its ANGLE libraries, and the package SHALL load ANGLE from that platform package.

#### Scenario: Fresh install renders
- **WHEN** `npm install @oxgl-js/oxgl` runs in an empty project on Linux arm64 (glibc) with no Rust toolchain, and the project creates a context with `backend: 'software'`, clears it and reads back the pixels
- **THEN** the install runs no install scripts, `@oxgl-js/linux-arm64-gnu` is the only platform package installed, and the pixels read back are the clear color

#### Scenario: Local build takes precedence
- **WHEN** a developer runs `npm run build` in the repository and imports the package from `dist/`
- **THEN** the addon and ANGLE libraries built into `dist/` are loaded, not a platform package from `node_modules`

### Requirement: Unsupported host fails at import, not install
On a host with no matching platform package, such as Linux with musl, `npm install @oxgl-js/oxgl` SHALL succeed. Importing the package SHALL then throw the error defined in "Missing native addon is reported clearly", and that error's message SHALL name the platform package the host would need, or state that the host has none.

#### Scenario: musl host
- **WHEN** `npm install @oxgl-js/oxgl` runs on Alpine Linux arm64 and the package is then imported
- **THEN** the install succeeds without installing a platform package, and the import throws an `Error` with `code === 'OXGL_NATIVE_MISSING'` whose message names `linux`, `arm64` and the lack of a musl build

#### Scenario: Architecture with no build
- **WHEN** the package is installed and imported on 32-bit x86 Linux with glibc
- **THEN** the import throws an `Error` with `code === 'OXGL_NATIVE_MISSING'` whose message says there is no build for `linux-ia32`, and names no package to install

#### Scenario: Optional dependencies omitted
- **WHEN** `npm install --omit=optional @oxgl-js/oxgl` runs on Linux x64 and the package is then imported
- **THEN** the import throws an `Error` with `code === 'OXGL_NATIVE_MISSING'` whose message names `@oxgl-js/linux-x64-gnu`
