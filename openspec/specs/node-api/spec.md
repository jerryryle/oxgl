# node-api Specification

## Purpose
Defines the contract of the `oxgl` npm package as a Node module: how it is imported, how it locates and loads the native addon for the host platform, and how loading failures are reported to callers.

## Requirements

### Requirement: Package entry point
The package SHALL be importable as `oxgl` from both ES modules (`import`) and CommonJS (`require`) on supported Node versions, and SHALL ship TypeScript declarations for every export.

#### Scenario: ESM import succeeds
- **WHEN** a supported platform's Node process runs `import * as oxgl from 'oxgl'`
- **THEN** the import resolves without error

#### Scenario: CommonJS require succeeds
- **WHEN** a supported platform's Node process runs `require('oxgl')`
- **THEN** the call returns the same exports as the ESM import

### Requirement: Native addon loading
On import, the package SHALL load the native addon built for the host platform and architecture through N-API, so a single binary works across all supported Node versions. The supported host is Linux arm64 (glibc). Other hosts the build recognises MAY load an addon built locally on them, but are not supported or tested.

#### Scenario: Addon loads on a supported platform
- **WHEN** the package is imported on Linux arm64 after `npm run build`
- **THEN** the native addon is loaded and the package reports no error

#### Scenario: Software rendering on Linux arm64
- **WHEN** the package is built and imported on Linux arm64 with no GPU
- **THEN** the addon loads, and a context created with `backend: 'software'` clears and reads back pixels correctly

#### Scenario: Local build on an unsupported host
- **WHEN** a developer runs `npm run build` on macOS arm64
- **THEN** the build succeeds using the macOS arm64 ANGLE bundle, and the documentation states that this host is not supported or tested

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
