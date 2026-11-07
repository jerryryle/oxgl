## MODIFIED Requirements

### Requirement: One row per test, one column per platform
The page SHALL have three sections: webgl1, webgl2 (conformance-testing) and three.js (threejs-examples). Each section SHALL have one row per page or example that any platform reported, sorted by name, and columns for linux-x64, linux-arm64, macos-arm64, windows-x64, windows-arm64, linux-x64-gles and linux-arm64-gles in that order (the last two: conformance-testing, "Platform of a run"). Each platform's column SHALL come from the `platform` its report records.

#### Scenario: Union of rows
- **WHEN** a webgl2 page appears in the Linux arm64 report but not in the Windows x64 report
- **THEN** the page has one row for it, with Linux arm64's outcome and "not run" under windows-x64

#### Scenario: Three.js columns
- **WHEN** the three.js examples ran only on Linux arm64
- **THEN** every three.js row shows Linux arm64's outcome and "not run" in the other six columns

#### Scenario: OpenGL ES backend column
- **WHEN** the webgl2 reports include one whose `platform` is `linux-x64-gles`
- **THEN** its outcomes appear in a linux-x64-gles column after windows-arm64, separate from linux-x64's

#### Scenario: OpenGL ES backend column on Linux arm64
- **WHEN** the webgl2 reports include one whose `platform` is `linux-arm64-gles`
- **THEN** its outcomes appear in a linux-arm64-gles column after linux-x64-gles, separate from linux-arm64's
