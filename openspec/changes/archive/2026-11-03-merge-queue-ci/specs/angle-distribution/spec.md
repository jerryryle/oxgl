# Spec Delta

## MODIFIED Requirements

### Requirement: ANGLE is built only when its recipe changes
ANGLE SHALL be built from source only by the recipe repository's build workflow, never by a workflow in oxgl's repository. That workflow SHALL run for every pull request and every merge group of the recipe repository's merge queue, and report one aggregate check that branch protection and the queue require. It SHALL build and smoke-test bundles only in a merge group, a manual run, or a pull request labelled `full-ci`, and only when the change touches the build recipe or the workflow itself; a workflow-only change SHALL NOT require a new bundle version. The aggregate check SHALL fail when a job the change needed was skipped.

#### Scenario: Recording digests does not rebuild
- **WHEN** an oxgl pull request changes only the bundle manifest
- **THEN** no ANGLE build runs, and oxgl's CI builds and tests against the newly pinned bundles

#### Scenario: oxgl change does not rebuild
- **WHEN** an oxgl pull request changes only oxgl's Rust or JavaScript code
- **THEN** no ANGLE build runs, and the native build uses the pinned prebuilt bundle

#### Scenario: Recipe pull request
- **WHEN** a pull request to the recipe repository without the `full-ci` label changes the build recipe
- **THEN** workflow lint and the bundle-version guard run, no bundle is built, and the aggregate check passes if they pass

#### Scenario: Recipe change builds and blocks
- **WHEN** a merge group of the recipe repository changes the build recipe (the pinned revision, build configuration, build scripts, license data or the bundle smoke test)
- **THEN** every platform bundle is built and smoke-tested, oxgl's CI does not run, and the group lands only if every build and smoke test passed

#### Scenario: Workflow-only change
- **WHEN** a merge group of the recipe repository changes only the build workflow, such as an action version bump, and keeps a bundle version that is already released
- **THEN** every platform bundle is built and smoke-tested, nothing is released when it lands, and the aggregate check passes if every build and smoke test passed

#### Scenario: Unexpected skip
- **WHEN** a merge group of the recipe repository changes the build recipe or the build workflow, and a build or smoke job is skipped
- **THEN** the aggregate check fails

#### Scenario: Non-recipe change in the recipe repository
- **WHEN** a pull request or merge group of the recipe repository changes only documentation
- **THEN** no bundle is built and the aggregate check passes

### Requirement: Published bundles are immutable
A published bundle version SHALL never be rebuilt or replaced. Every recipe change SHALL produce a new bundle version (a change to the build workflow alone is not a recipe change; see "ANGLE is built only when its recipe changes"), and the recipe repository's build workflow SHALL fail before compiling when the pinned bundle version is already released there, or when the change's own diff from the commit it is built on (a pull request's base; in a merge group, the parent of the group's head commit) touches the recipe and the version is not greater than at that commit. The bundles a release publishes SHALL be the files the merge group run that tested the released commit built and smoke-tested; the release SHALL NOT build anything. Copying a published bundle's files unchanged to another release, with the same digests, is not a rebuild.

#### Scenario: Forgotten version bump
- **WHEN** a pull request to the recipe repository changes a build recipe file other than the build workflow but keeps a bundle version that is already released
- **THEN** the build workflow fails in its first step, naming the version to bump

#### Scenario: Two recipe changes queued apart
- **WHEN** two recipe pull requests both set `bundle_version` to `angle-8078.10`, and the second is queued behind the first
- **THEN** the second entry's guard fails, naming `angle-8078.10`, so the second pull request leaves the queue and lands only after it picks a later version

#### Scenario: Documentation change queued behind a recipe change
- **WHEN** a README-only pull request is queued behind a recipe change that sets `angle-8078.10`
- **THEN** its own change touches no recipe file, so the guard doesn't compare versions for it

#### Scenario: Existing release is not overwritten
- **WHEN** the release job runs for a bundle version that already has a release
- **THEN** it fails without uploading anything

#### Scenario: Released bundles are the smoke-tested ones
- **WHEN** a recipe change lands on the recipe repository's `main` and its bundle version is released
- **THEN** each released bundle's SHA-256 matches the bundle that the commit's merge group run built and smoke-tested, and no bundle is compiled after the change lands

#### Scenario: Recipe change merged past the queue
- **WHEN** a recipe change lands on the recipe repository's `main` without a merge group run
- **THEN** nothing is released, and the run's log says to start the build workflow manually on `main`, which builds, smoke-tests and releases that commit

### Requirement: Only releases from the recipe repository's own workflows are pinned
The bump SHALL pin a recipe-repository release only when GitHub Actions created it and uploaded every one of its assets, and its tag points at a commit on the recipe repository's `main`. Otherwise it SHALL refuse it and name the reason, and nothing SHALL be opened for it.

#### Scenario: Release created with a personal token
- **WHEN** the latest oxgl-angle release was created by a user account rather than `github-actions[bot]`
- **THEN** the bump opens no pull request and its log names the release and its author

#### Scenario: Asset replaced after release
- **WHEN** a release created by `github-actions[bot]` has an asset, such as `SHA256SUMS` or a bundle, uploaded by a user account
- **THEN** the bump opens no pull request and its log names the asset and its uploader

#### Scenario: Tag off main
- **WHEN** the latest release's tag points at a commit that isn't on oxgl-angle's `main`
- **THEN** the bump opens no pull request and its log names the tag and the commit

### Requirement: A bump that needs a person waits
A bump whose merge group run fails SHALL leave the queue and stay open. A later bump run SHALL NOT overwrite a bump branch that carries any commit other than the bot's. A commit a person pushes to the bump branch lands through the merge queue like any other change once the pull request's checks pass. A closed bump pull request labelled `skip-bump` SHALL stop the bump from proposing that bundle version again until the label is removed.

#### Scenario: Conformance changes with the new ANGLE
- **WHEN** a bump's merge group run fails because a conformance page's outcome changed
- **THEN** the pull request leaves the queue and stays open for a person to update the expectations, and no version is published

#### Scenario: Fix pushed to the bump
- **WHEN** a person pushes a commit that updates the expectations to the `angle-bump` branch
- **THEN** the pull request's checks run again, the pull request lands through the merge queue when they and its merge group run pass, and later bump runs leave the branch unchanged until then

#### Scenario: Skipped bundle version
- **WHEN** a bump pull request to `angle-8078.7` is labelled `skip-bump` and closed
- **THEN** later bump runs do not propose `angle-8078.7`, and they propose the next release after it once one exists

## ADDED Requirements

### Requirement: Recipe releases start oxgl's bump
When the recipe repository's release job publishes a bundle version, it SHALL then start oxgl's bump. oxgl's bump SHALL also run when started manually and on every push to `main`, and SHALL NOT run on a schedule.

#### Scenario: Release published
- **WHEN** the recipe repository releases `angle-8078.10`
- **THEN** oxgl's bump runs within minutes and proposes `angle-8078.10`

#### Scenario: Push to main
- **WHEN** a change lands on `main` while an unmodified bump pull request is open
- **THEN** oxgl's bump runs, and refreshes that pull request only as "A stale bump is rebuilt" requires

#### Scenario: Missed start
- **WHEN** a recipe release didn't start oxgl's bump
- **THEN** starting oxgl's bump manually proposes the latest release

### Requirement: New bundle releases are proposed when released
When oxgl's bump runs, once any version of `@oxgl-js/oxgl` is on npm, it SHALL compare the recipe repository's latest release with the bundle version oxgl pins. When they differ, it SHALL open or refresh a pull request from the `angle-bump` branch that pins the release's bundles and digests, taken from the release's `SHA256SUMS`, and bumps the patch version, and SHALL turn on the pull request's auto-merge so it lands through the merge queue once its checks pass.

#### Scenario: New release found
- **WHEN** the bump finds that oxgl-angle's latest release is `angle-8078.7`, `bundles.toml` pins `angle-8078.6`, and `version` is `0.1.3`
- **THEN** a pull request from `angle-bump` changes only `angle/bundles.toml` (every URL and digest from `angle-8078.7`'s release) and the version (`0.1.4` in `package.json` and `package-lock.json`), its quick checks run, and auto-merge is on

#### Scenario: Green bump lands and releases
- **WHEN** a bump's quick checks pass and its merge group run passes
- **THEN** it lands on `main` and `0.1.4` is published from that merge group run's packages (release, "A new version on main is released")

#### Scenario: Before the first release
- **WHEN** the bump finds a newer bundle release but npm has no published `@oxgl-js/oxgl`
- **THEN** it opens no pull request and changes nothing

#### Scenario: Nothing new
- **WHEN** the latest release is the pinned bundle version
- **THEN** no pull request is opened or changed, and an open bump pull request that main no longer needs is closed

### Requirement: A stale bump is rebuilt
When oxgl's bump runs, it SHALL rebuild an open bump that carries only the bot's commit from the current `main` when that bump's version is no longer greater than `main`'s or it no longer merges cleanly, and SHALL leave it unchanged otherwise, so a queued bump isn't pulled out of the queue.

#### Scenario: Main's version moved
- **WHEN** an unmodified bump to `0.2.3` is open and a developer's change that also bumps to `0.2.3` lands on `main`
- **THEN** the bump runs on that push and rebuilds the pull request from the current `main` at `0.2.4`, with auto-merge on

#### Scenario: Main moved without touching the bump
- **WHEN** an unmodified bump is in the merge queue and a documentation change lands on `main`
- **THEN** the bump leaves the pull request unchanged, and it stays in the queue

### Requirement: A stale recipe bump is rebuilt
The recipe repository's daily run SHALL rebuild an open bump that carries only the bot's commit only when Chrome stable moved again, its `bundle_version` is no longer greater than `main`'s, or it no longer merges cleanly, so a bump building in the queue isn't pulled out and restarted.

#### Scenario: Main moves while the bump is queued
- **WHEN** a recipe bump is building in the merge queue and a README change lands on the recipe repository's `main`
- **THEN** the next daily run leaves the bump unchanged, and its builds continue

### Requirement: The recipe repository follows Chrome stable
Once a day, when the ANGLE commit Chrome stable ships differs from the recipe repository's pinned commit, the recipe repository SHALL open a pull request from its `angle-bump` branch that pins that commit with a new bundle version, with auto-merge on, so the merge queue builds, smoke-tests and lands it. A bump that needs a person waits as oxgl's does.

#### Scenario: Chrome stable moves
- **WHEN** Chrome stable ships an ANGLE commit other than the pinned one
- **THEN** a pull request pins that commit with the next bundle version, and once its merge group run passes it lands, its bundles are released, and oxgl's bump starts

#### Scenario: A patch no longer applies
- **WHEN** the recipe bump's merge group run fails because a source patch doesn't apply to the new commit
- **THEN** the pull request leaves the queue and stays open for a person, and nothing is released

## REMOVED Requirements

### Requirement: New bundle releases are proposed daily
**Reason**: A recipe release now starts oxgl's bump directly, and the merge queue tests the bump against `main` as it will land, so the daily schedule goes, and the bump is rebuilt only when `main`'s version or a conflict makes it unmergeable, not whenever `main` moves.
**Migration**: See "Recipe releases start oxgl's bump" and "New bundle releases are proposed when released". Start oxgl's bump manually to propose the latest release at any time.

### Requirement: A passing bump merges and releases
**Reason**: The merge queue lands a bump whose checks pass, on the commit it tested, so CI no longer merges bump pull requests or starts runs on `main` itself.
**Migration**: Auto-merge, turned on by the bump, puts the pull request in the queue ("New bundle releases are proposed when released"), and the release follows the push to `main` (release, "A new version on main is released").
