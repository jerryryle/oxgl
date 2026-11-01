# Spec Delta

## Purpose

Defines how a version of oxgl becomes a set of published npm packages: when a release happens, which packages it consists of, where their contents come from, and how publishing is authenticated and recorded.

## ADDED Requirements

### Requirement: A new version on main is released
After the `ci` check passes for a run on `main`, the release SHALL publish the version in `package.json` when npm doesn't already have it, and SHALL publish nothing when it does. Only runs on `main` SHALL publish. Pull request runs and runs on other branches never do.

#### Scenario: Version bump merged
- **WHEN** a pull request that changes `version` from `0.1.3` to `0.1.4` is merged and `ci` passes on the resulting `main` commit
- **THEN** version `0.1.4` of every package is published to npm

#### Scenario: Push without a version bump
- **WHEN** a push to `main` leaves `version` at a version npm already has, and `ci` passes
- **THEN** nothing is published, no package tarballs are kept, and the run makes no publish attempt

#### Scenario: CI fails on main
- **WHEN** `ci` fails for a `main` commit whose version is not yet on npm
- **THEN** nothing is published

#### Scenario: Pull request run
- **WHEN** CI runs for a pull request that bumps the version
- **THEN** nothing is published

### Requirement: Packages released together
A release SHALL consist of `oxgl` and one platform package per supported platform: `@oxgl-js/linux-x64-gnu`, `@oxgl-js/linux-arm64-gnu`, `@oxgl-js/darwin-arm64`, `@oxgl-js/win32-x64-msvc` and `@oxgl-js/win32-arm64-msvc`, all at the same version. `oxgl` SHALL list every platform package as an optional dependency at exactly that version. Each platform package SHALL declare its `os`, `cpu` and, on Linux, `libc`, so npm installs only the matching one.

#### Scenario: Versions agree
- **WHEN** the published `oxgl@0.1.4` manifest is read
- **THEN** its `optionalDependencies` name all five platform packages at exactly `0.1.4`, and each of those is published at `0.1.4`

#### Scenario: Platform package constraints
- **WHEN** the published `@oxgl-js/linux-arm64-gnu` manifest is read
- **THEN** it declares `os: ["linux"]`, `cpu: ["arm64"]` and `libc: ["glibc"]`

### Requirement: Published files are the tested files
Each platform package published SHALL be the packed file that the same CI run built and smoke-tested on that platform (continuous-integration, "Packed packages are smoke-tested"). The `oxgl` package SHALL likewise be the packed file one of that run's smoke tests installed. The release SHALL NOT build or pack anything itself.

#### Scenario: Release uses the run's tarballs
- **WHEN** the release publishes `@oxgl-js/win32-arm64-msvc`
- **THEN** the published tarball's SHA-512 integrity matches the tarball the same run's Windows arm64 job packed and smoke-tested

### Requirement: A partial release can be completed by a rerun
The release SHALL publish the platform packages before `oxgl`, and SHALL skip each package that npm already has at the version being released. Rerunning a release that failed partway SHALL therefore publish only what is missing. It SHALL never republish or overwrite a published version.

#### Scenario: Rerun after a failure
- **WHEN** a release published three platform packages, then failed, and the run's release job is rerun
- **THEN** the rerun publishes the remaining two platform packages and then `oxgl`, and leaves the three published ones unchanged

#### Scenario: `oxgl` never precedes its platform packages
- **WHEN** publishing any platform package fails
- **THEN** `oxgl` at that version is not published

### Requirement: Trusted publishing with provenance
The release SHALL authenticate to npm through trusted publishing (OIDC), from a job in the `npm` GitHub environment, which only `main` may deploy to. No npm token SHALL be stored in the repository or its secrets. Every package SHALL be published with a provenance attestation that names the repository, workflow and commit.

#### Scenario: Provenance visible
- **WHEN** a released version is viewed on npmjs.com
- **THEN** its provenance names `jerryryle/oxgl`, the CI workflow and the commit the version was built from

#### Scenario: No token in the repository
- **WHEN** the repository's and the `npm` environment's secrets are listed
- **THEN** none is an npm token

### Requirement: Linux packages run on glibc 2.34
Every native library in a Linux platform package, the addon and its ANGLE libraries alike, SHALL need no `GLIBC_` symbol version newer than 2.34, so the package loads on Ubuntu 22.04, Debian 12 and newer glibc systems. CI SHALL check this on the packed Linux packages and fail the `ci` check when a library needs a newer version.

#### Scenario: Built on a newer glibc
- **WHEN** a runner image change makes the Linux arm64 addon need `GLIBC_2.39`
- **THEN** that platform's check fails, naming the library and the version it needs, and nothing is published

#### Scenario: Current build
- **WHEN** the packed Linux packages are checked
- **THEN** no library needs a `GLIBC_` version newer than 2.34, and the check passes

### Requirement: Releases are tagged
After every package of a version has been published, the release SHALL create the tag `v<version>` on the commit that was built, and a GitHub Release for that tag with generated release notes, unless that GitHub Release already exists.

#### Scenario: Tag and release created
- **WHEN** version `0.1.4` is published from commit `abc123`
- **THEN** the tag `v0.1.4` points at `abc123`, and a GitHub Release named `v0.1.4` exists with notes listing the merged pull requests since `v0.1.3`

#### Scenario: Rerun after the packages are published
- **WHEN** every package of `0.1.4` is on npm but creating the GitHub Release failed, and the run's release job is rerun
- **THEN** the rerun publishes nothing and creates the tag and the GitHub Release
