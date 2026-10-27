# Spec Delta

## Purpose

Defines the contract of the `oxgl` npm package as a Node module: how it is imported, how it locates and loads the native addon for the host platform, and how loading failures are reported to callers.

## ADDED Requirements

### Requirement: Package entry point
The package SHALL be importable as `oxgl` from both ES modules (`import`) and CommonJS (`require`) on supported Node versions, and SHALL ship TypeScript declarations for every export.

#### Scenario: ESM import succeeds
- **WHEN** a supported platform's Node process runs `import * as oxgl from 'oxgl'`
- **THEN** the import resolves without error

#### Scenario: CommonJS require succeeds
- **WHEN** a supported platform's Node process runs `require('oxgl')`
- **THEN** the call returns the same exports as the ESM import

### Requirement: Native addon loading
On import, the package SHALL load the native addon built for the host platform and architecture (Linux x64, macOS arm64, Windows x64) through N-API, so a single binary works across all supported Node versions.

#### Scenario: Addon loads on a supported platform
- **WHEN** the package is imported on a supported platform after `npm run build`
- **THEN** the native addon is loaded and the package reports no error

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
