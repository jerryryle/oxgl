## ADDED Requirements

### Requirement: Platform-limited expectations
The three.js runner SHALL accept an expectations entry that lists, after its expectation, the platforms it applies to (`<example> <OUTCOME> [<platform> ...] # <reason>`), and SHALL use the same platform names and the same rules for applying, judging and updating such entries as conformance expectations (conformance-testing, "Platform-limited expectations" and "Expectations update run"). An entry without a list applies on every platform.

#### Scenario: Tolerance limited to some platforms
- **WHEN** `webgl_shadowmap_viewer` is listed as `DIFF 1% [linux-x64 linux-arm64 windows-x64 windows-arm64]` and differs from its reference in 0.05% of pixels on macOS arm64
- **THEN** a macOS arm64 run judges it as having no entry, so it is expected to `PASS` and passes, while a Linux arm64 run still allows it 1%

#### Scenario: Update on one platform keeps the others' entries
- **WHEN** `webgl_shadowmap_viewer` is listed as `DIFF 1%` with no platforms, it matches within 0.1% on macOS arm64, and the developer runs the update there
- **THEN** the entry becomes `DIFF 1% [linux-x64 linux-arm64 windows-x64 windows-arm64]` with its reason kept, so runs on the other platforms still allow 1%

## MODIFIED Requirements

### Requirement: Pinned three.js release
The repository SHALL pin one three.js release by commit hash, recording the release's tag alongside it. A run SHALL use only that commit's `build/`, `examples/` and `test/e2e/` trees, obtained by commit hash, with the bytes the commit stores on every host, fetched once and reused while the pin is unchanged. They SHALL NOT be committed to the oxgl repository.

#### Scenario: Release fetched by pinned commit
- **WHEN** a developer runs the three.js command on a clean checkout
- **THEN** it obtains `build/`, `examples/` and `test/e2e/` at the pinned commit, reuses that copy on later runs, and fetches again only when the pin changes

#### Scenario: Windows host converting line endings
- **WHEN** the release is fetched on a Windows host whose Git configuration sets `core.autocrlf=true`
- **THEN** every example, shader and model is served with the same bytes as on Linux, so the parse allowance and the loaders see the same input

### Requirement: Results report
Every run SHALL write a machine-readable report that records, per example, the outcome, the percentage of differing pixels when a frame was compared, the duration, and the first error or message. An example with an expectations entry that applies on the run's platform SHALL also record that entry's reason. It SHALL also record the pinned tag and commit, the requested backend, both time limits, the parallelism, the platform, named as in platform-limited expectations, and the timestamp. Each `TIMEOUT` SHALL name the limit it reached.

#### Scenario: Timeout names its limit
- **WHEN** an example keeps a request pending forever
- **THEN** its report entry is `TIMEOUT` and names the limit without progress, and the report records both limits

#### Scenario: Reason recorded for a skipped example
- **WHEN** `css3d_youtube` is listed as `SKIP # upstream: video hangs CI` and the run does not include skipped examples
- **THEN** its report entry records the outcome `SKIP` and the reason "upstream: video hangs CI"

#### Scenario: Platform named as in the expectations
- **WHEN** the suite runs on macOS arm64 or Windows x64
- **THEN** the report records the platform as `macos-arm64` or `windows-x64`, as the conformance report does, not Node's `darwin-arm64` or `win32-x64`
