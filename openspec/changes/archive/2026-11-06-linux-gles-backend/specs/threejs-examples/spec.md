## MODIFIED Requirements

### Requirement: Platform-limited expectations
The three.js runner SHALL accept an expectations entry that lists, after its expectation, the platforms it applies to (`<example> <OUTCOME> [<platform> ...] # <reason>`), and SHALL use the same platform names and the same rules for applying, judging and updating such entries as conformance expectations (conformance-testing, "Platform-limited expectations" and "Expectations update run"). An entry without a list applies on every platform.

#### Scenario: Tolerance limited to some platforms
- **WHEN** `webgl_shadowmap_viewer` is listed as `DIFF 1% [linux-x64 linux-arm64 windows-x64 windows-arm64]` and differs from its reference in 0.05% of pixels on macOS arm64
- **THEN** a macOS arm64 run judges it as having no entry, so it is expected to `PASS` and passes, while a Linux arm64 run still allows it 1%

#### Scenario: Update on one platform keeps the others' entries
- **WHEN** `webgl_shadowmap_viewer` is listed as `DIFF 1%` with no platforms, it matches within 0.1% on macOS arm64, and the developer runs the update there
- **THEN** the entry becomes `DIFF 1% [linux-x64 linux-arm64 windows-x64 windows-arm64 linux-x64-gles]` with its reason kept, so runs on the other platforms still allow 1%
