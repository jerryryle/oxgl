# Spec Delta

## MODIFIED Requirements

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
