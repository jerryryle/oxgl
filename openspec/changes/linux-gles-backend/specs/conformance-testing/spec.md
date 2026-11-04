## MODIFIED Requirements

### Requirement: Platform-limited expectations
An entry's platforms SHALL be among `linux-x64`, `linux-arm64`, `macos-arm64`, `windows-x64`, `windows-arm64` and `linux-x64-gles`. A run's platform SHALL be `linux-x64-gles` when it runs on Linux x64 with `OXGL_BACKEND=gles` (backend-selection, "OXGL_BACKEND environment override"), and its host's platform name otherwise. An entry without platforms SHALL apply on every platform and SHALL be the page's only entry in its suite. An entry with platforms SHALL apply only on those, and elsewhere the page SHALL be judged as if it had no entry. A page MAY have several entries in a suite when each lists platforms and no platform is in two of them.

#### Scenario: Entry limited to other platforms
- **WHEN** a page's entry is `FAIL` for `linux-x64` and `windows-x64`, and the page passes on Linux arm64
- **THEN** the page has its expected outcome there, and the entry is neither reported stale nor changed by an update run

#### Scenario: Entry limited to this platform
- **WHEN** a page's entry is `FAIL` for `linux-x64` and `windows-x64`, and the page fails on Linux x64
- **THEN** the page has its expected outcome

#### Scenario: Unknown platform
- **WHEN** an entry names a platform that is not one of the six
- **THEN** the conformance command fails before running any page and names the entry

#### Scenario: Different outcomes on different platforms
- **WHEN** a page has a `FAIL` entry for `linux-x64` and a `TIMEOUT` entry for `macos-arm64`
- **THEN** a run on each of those platforms expects that platform's outcome, and a run elsewhere expects `PASS`

#### Scenario: Overlapping entries
- **WHEN** a page has two entries in one suite whose platform lists share a platform, or an entry without platforms and another entry
- **THEN** the conformance command fails before running any page and names the entries

#### Scenario: OpenGL ES backend judged on its own platform
- **WHEN** a page's entry is `FAIL` for `linux-x64`, and the page passes in a run on Linux x64 with `OXGL_BACKEND=gles`
- **THEN** the run's platform is `linux-x64-gles`, the page has its expected outcome, and the entry is neither reported stale nor changed by that run's update

### Requirement: Expectations update run
An update run SHALL rewrite the expectations file from its outcomes on its own platform. It SHALL treat an entry without platforms as listing all six, and SHALL write an entry that lists all six without platforms. It SHALL leave `SKIP` entries, and entries that do not apply on its platform, unchanged. For a page whose entry with platforms applies, it SHALL remove the run's platform from that entry when the page passes or has a different outcome, removing the entry when no platform remains.

#### Scenario: Update on one platform keeps an entry for the others
- **WHEN** an update run on macOS arm64 finds that a page passes whose entry is `FAIL` without platforms
- **THEN** the entry is rewritten as `FAIL` for `linux-x64`, `linux-arm64`, `windows-x64`, `windows-arm64` and `linux-x64-gles`

#### Scenario: Update after a platform starts passing
- **WHEN** an update run on Windows x64 finds that a page passes whose entry is `FAIL` for `linux-x64` and `windows-x64`
- **THEN** the entry is rewritten as `FAIL` for `linux-x64` only

#### Scenario: Update on the OpenGL ES backend
- **WHEN** an update run with `OXGL_BACKEND=gles` on Linux x64 finds that a page passes whose entry is `FAIL` without platforms
- **THEN** the entry is rewritten as `FAIL` for the five other platforms, and runs on them still expect `FAIL`

### Requirement: Expectations update adds outcomes
When an update run's page has a non-`PASS` outcome and no entry applies, the run SHALL add its platform to the page's entry with that outcome if one exists, otherwise add an entry for its platform alone if the page has entries with platforms, and otherwise add an entry without platforms. A run on `linux-x64-gles` SHALL instead always add an entry for its platform alone, since the OpenGL ES backend's outcomes don't carry over to the software backend.

#### Scenario: Update after a platform starts failing
- **WHEN** an update run on macOS arm64 finds that a page fails whose only entry is `FAIL` for `linux-x64` and `windows-x64`
- **THEN** the entry is rewritten as `FAIL` for `linux-x64`, `windows-x64` and `macos-arm64`

#### Scenario: New failure on the OpenGL ES backend
- **WHEN** an update run with `OXGL_BACKEND=gles` on Linux x64 finds that a page without entries fails
- **THEN** it adds an entry for `linux-x64-gles` alone, and the five other platforms still expect the page to pass
