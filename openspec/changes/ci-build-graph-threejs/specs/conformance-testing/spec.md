## MODIFIED Requirements

### Requirement: Pinned conformance suite
The repository SHALL pin one commit of the Khronos WebGL repository (`KhronosGroup/WebGL`) whose `sdk/tests` tree is the suite under test. A run SHALL use only that commit's files, obtained by commit hash, with the bytes the commit stores on every host, whatever the host's Git line-ending configuration. The suite SHALL NOT be committed to the oxgl repository.

#### Scenario: Suite fetched by pinned commit
- **WHEN** a developer runs the conformance command on a clean checkout
- **THEN** it obtains `sdk/tests` at the pinned commit, reuses that copy on later runs, and fetches again only when the pin changes

#### Scenario: Pin changed
- **WHEN** a change updates the pinned commit
- **THEN** the next run uses the new commit's tests, and any resulting differences from the expectations fail the run until the expectations are updated in the same change

#### Scenario: Windows host converting line endings
- **WHEN** the suite is fetched on a Windows host whose Git configuration sets `core.autocrlf=true`
- **THEN** every fetched file has the same bytes as on Linux, with no line ending converted
