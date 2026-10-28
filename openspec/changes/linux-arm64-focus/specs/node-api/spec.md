# Spec Delta

## MODIFIED Requirements

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
