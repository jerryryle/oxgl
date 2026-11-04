# Spec Delta

## MODIFIED Requirements

### Requirement: A new version on main is released
When a commit lands on `main` whose version in `package.json` npm doesn't already have, the release SHALL publish that version from the files of the merge group run that tested that commit, after that run's `ci` check passed (continuous-integration, "The merge queue runs the full checks"). A manual run on `main` SHALL release in the same way from its own files. When npm already has the version, nothing SHALL be published. When no passing merge group run exists for the commit, as after a merge that bypassed the queue, the release SHALL fail, publish nothing, and say to start a manual run on `main`. Pull request runs, merge group runs and runs on other branches never publish.

#### Scenario: Version bump merged
- **WHEN** a pull request that changes `version` from `0.1.3` to `0.1.4` lands through the merge queue
- **THEN** version `0.1.4` of every package is published to npm from the packages that merge group's run built and tested

#### Scenario: Push without a version bump
- **WHEN** a push to `main` leaves `version` at a version npm already has
- **THEN** nothing is published and the run makes no publish attempt

#### Scenario: Merge group fails
- **WHEN** `ci` fails for a merge group whose version is not yet on npm
- **THEN** nothing lands on `main` and nothing is published

#### Scenario: CI fails on main
- **WHEN** `ci` fails for a manual run on `main` whose version is not yet on npm
- **THEN** nothing is published

#### Scenario: Another change lands before the release finishes
- **WHEN** a change at `0.2.3` lands, and before its release has published, a README change queued behind it lands at the same version
- **THEN** releases run one at a time, the second finds every `0.2.3` package and the `v0.2.3` GitHub Release already published, and publishes nothing

#### Scenario: Merge past the queue
- **WHEN** a commit whose version npm doesn't have lands on `main` without a merge group run
- **THEN** the release fails without publishing, and its log says to start CI manually on `main`, which builds, tests and releases that commit

#### Scenario: Pull request run
- **WHEN** CI runs for a pull request or a merge group that bumps the version
- **THEN** nothing is published

### Requirement: Published files are the tested files
Each platform package published SHALL be the packed file that the build job of the run that tested the commit (the commit's merge group run, or the manual run on `main` that releases it) built and smoke-tested on that platform, and that the run's test jobs on that platform ran against (continuous-integration, "Each platform is built once per run"). The `@oxgl-js/oxgl` package SHALL likewise be the packed file one of that run's smoke tests installed and every test job ran against. The release SHALL NOT build or pack anything itself.

#### Scenario: Release uses the run's tarballs
- **WHEN** the release publishes `@oxgl-js/win32-arm64-msvc`
- **THEN** the published tarball's SHA-512 integrity matches the tarball the merge group run's Windows arm64 build job packed and smoke-tested, and that the run's Windows arm64 conformance and three.js jobs unpacked

#### Scenario: One main package for every platform
- **WHEN** the release publishes `@oxgl-js/oxgl`
- **THEN** its tarball is the one the Linux arm64 build job packed, and the JavaScript every platform's test jobs ran is that tarball's

### Requirement: A partial release can be completed by a rerun
The release SHALL publish the platform packages before `@oxgl-js/oxgl`, and SHALL skip each package that npm already has at the version being released. Rerunning a release that failed partway SHALL therefore publish only what is missing, from the same tested run's files. It SHALL never republish or overwrite a published version.

#### Scenario: Rerun after a failure
- **WHEN** a release published three platform packages, then failed, and the release job is rerun
- **THEN** the rerun publishes the remaining two platform packages and then `@oxgl-js/oxgl`, taken from the same merge group run, and leaves the three published ones unchanged

#### Scenario: Main tarball told apart from the platform tarballs
- **WHEN** the release's directory holds `oxgl-js-oxgl-0.1.1.tgz` and the five `oxgl-js-<platform>-0.1.1.tgz` platform tarballs
- **THEN** it publishes each of the five platform packages once, and then `@oxgl-js/oxgl` once from `oxgl-js-oxgl-0.1.1.tgz`

#### Scenario: `@oxgl-js/oxgl` never precedes its platform packages
- **WHEN** publishing any platform package fails
- **THEN** `@oxgl-js/oxgl` at that version is not published
