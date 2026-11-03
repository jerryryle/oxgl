# Spec Delta

## MODIFIED Requirements

### Requirement: ANGLE revision is pinned in the repository
The ANGLE build recipe SHALL live in its own repository, `oxgl-js/oxgl-angle` (the recipe repository), which SHALL record the pinned ANGLE revision (commit and Chromium branch), the bundle version and each platform's build configuration. oxgl's bundle manifest SHALL record the bundle version it uses and each platform's bundle URL and SHA-256 digest, every URL in that version's recipe-repository release. Changing either SHALL be a reviewable change to tracked files.

#### Scenario: Pin is inspectable
- **WHEN** a reviewer reads the recipe repository's pin and oxgl's bundle manifest
- **THEN** the pin names the ANGLE commit, the Chromium branch and the bundle version, and the manifest names that bundle version with one bundle URL and SHA-256 digest for each of Linux x64, Linux arm64, macOS arm64, Windows x64, and Windows arm64

#### Scenario: Manifest URL outside the named release
- **WHEN** a bundle URL in oxgl's bundle manifest does not point at the recipe repository's release for the manifest's bundle version
- **THEN** oxgl's repository checks fail and name the platform and URL
