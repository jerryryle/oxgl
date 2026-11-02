## MODIFIED Requirements

### Requirement: Published files are the tested files
Each platform package published SHALL be the packed file that the same CI run's build job built and smoke-tested on that platform, and that the run's test jobs on that platform ran against (continuous-integration, "Each platform is built once per run"). The `@oxgl-js/oxgl` package SHALL likewise be the packed file one of that run's smoke tests installed and every test job ran against. The release SHALL NOT build or pack anything itself.

#### Scenario: Release uses the run's tarballs
- **WHEN** the release publishes `@oxgl-js/win32-arm64-msvc`
- **THEN** the published tarball's SHA-512 integrity matches the tarball the same run's Windows arm64 build job packed and smoke-tested, and that the run's Windows arm64 conformance and three.js jobs unpacked

#### Scenario: One main package for every platform
- **WHEN** the release publishes `@oxgl-js/oxgl`
- **THEN** its tarball is the one the Linux arm64 build job packed, and the JavaScript every platform's test jobs ran is that tarball's
