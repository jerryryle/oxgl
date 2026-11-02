# Spec Delta

## ADDED Requirements

### Requirement: Manual runs
CI SHALL also run when started manually (`workflow_dispatch`) on any branch, running every job against the branch's head commit, as when the changed files cannot be determined. A manual run SHALL cancel an earlier one still in progress on the same branch, except on `main`, where every run completes.

#### Scenario: Manual run
- **WHEN** CI is started manually on a branch
- **THEN** every job runs against the branch's head commit, the `ci` check is reported on that commit, and an earlier manual run still in progress on that branch is cancelled unless the branch is `main`

### Requirement: Packed packages are smoke-tested
On each supported platform, CI SHALL pack `@oxgl-js/oxgl` and that platform's package with `npm pack`, and install both tarballs into an empty project outside the repository. It SHALL then import the package there and render with `backend: 'software'`. A failure SHALL fail the `ci` check. On `main`, when the version is not yet on npm, each platform job SHALL keep its platform tarball as a run artifact for the release, and exactly one designated job SHALL also keep its `@oxgl-js/oxgl` tarball.

#### Scenario: Packaging mistake caught
- **WHEN** a pull request leaves the ANGLE libraries out of a platform package's file list
- **THEN** that platform's smoke test fails at import with `OXGL_NATIVE_MISSING`, and the `ci` check fails

#### Scenario: Test runs against the tarballs
- **WHEN** the smoke test runs
- **THEN** it resolves `@oxgl-js/oxgl` and the platform package from the empty project's `node_modules`, not from the repository's `dist/`, and a context created with `backend: 'software'` clears and reads back the clear color
