# Spec Delta

## ADDED Requirements

### Requirement: New bundle releases are proposed daily
Once a day, once any version of `@oxgl-js/oxgl` is on npm, a workflow SHALL compare the recipe repository's latest release with the bundle version oxgl pins. When they differ, it SHALL open or refresh a pull request from the `angle-bump` branch. That pull request SHALL pin the release's bundles and digests, taken from the release's `SHA256SUMS`, bump the patch version unless main's version is not yet on npm, and start CI on its head commit. It SHALL be based on the current `main`.

#### Scenario: New release found
- **WHEN** the daily run finds that oxgl-angle's latest release is `angle-8078.7`, `bundles.toml` pins `angle-8078.6`, and `version` is `0.1.3`
- **THEN** a pull request from `angle-bump` changes only `angle/bundles.toml` (every URL and digest from `angle-8078.7`'s release) and the version (`0.1.4` in `package.json` and `package-lock.json`), and CI runs on its head commit

#### Scenario: Unreleased version on main
- **WHEN** a new bundle release is found and `main` is at `0.2.0`, which npm does not have yet
- **THEN** the bump pull request leaves the version at `0.2.0`, so the release after it merges publishes `0.2.0` with the new bundles

#### Scenario: Before the first release
- **WHEN** the daily run finds a newer bundle release but npm has no published `@oxgl-js/oxgl`
- **THEN** it opens no pull request and changes nothing

#### Scenario: Nothing new
- **WHEN** the latest release is the pinned bundle version
- **THEN** no pull request is opened or changed, and an open bump pull request that main no longer needs is closed

#### Scenario: Main moved on
- **WHEN** an unmodified bump pull request is open and `main` has gained commits since it was made
- **THEN** the next daily run rebuilds the bump from the current `main` and starts CI on it again

### Requirement: Only releases from the recipe repository's own workflows are pinned
The daily bump and the merge SHALL pin a recipe-repository release only when GitHub Actions created it and uploaded every one of its assets, and its tag points at a commit on the recipe repository's `main`. Otherwise they SHALL refuse it and name the reason, and nothing SHALL be opened or merged for it.

#### Scenario: Release created with a personal token
- **WHEN** the latest oxgl-angle release was created by a user account rather than `github-actions[bot]`
- **THEN** the daily run opens no pull request and its log names the release and its author

#### Scenario: Asset replaced after release
- **WHEN** a release created by `github-actions[bot]` has an asset, such as `SHA256SUMS` or a bundle, uploaded by a user account
- **THEN** the daily run opens no pull request and its log names the asset and its uploader

#### Scenario: Tag off main
- **WHEN** the latest release's tag points at a commit that isn't on oxgl-angle's `main`
- **THEN** the daily run opens no pull request and its log names the tag and the commit

### Requirement: A passing bump merges and releases
When CI passes on the `angle-bump` head commit, and that commit is exactly the change the bump would make to the current `main` for the bundle version the commit names, CI SHALL merge the pull request at that commit and start CI on `main`. The new version is then released as any other new version is (release, "A new version on main is released").

#### Scenario: Green bump
- **WHEN** CI passes on an unmodified bump to `angle-8078.7` at version `0.1.4`
- **THEN** the pull request is squash-merged at the tested commit, CI runs on `main`, and `0.1.4` is published to npm once that run passes

#### Scenario: Newer bundle released during CI
- **WHEN** CI passes on a bump to `angle-8078.7`, and oxgl-angle released `angle-8078.8` while it ran
- **THEN** the bump to `angle-8078.7` is merged and released, and the next daily run proposes `angle-8078.8`

#### Scenario: Main moved during CI
- **WHEN** CI passes on a bump but `main` gained a commit while it ran
- **THEN** the pull request is not merged, and the next daily run refreshes it

### Requirement: A bump that needs a person waits
A bump whose CI fails, or whose branch carries any commit other than the bot's, SHALL stay open and SHALL NOT be merged automatically or overwritten by a later daily run. A closed bump pull request labelled `skip-bump` SHALL stop the daily run from proposing that bundle version again until the label is removed.

#### Scenario: Conformance changes with the new ANGLE
- **WHEN** a bump's CI fails because a conformance page's outcome changed
- **THEN** the pull request stays open for a person to update the expectations, and no version is published

#### Scenario: Fix pushed to the bump
- **WHEN** a person pushes a commit to `angle-bump` and CI passes
- **THEN** the pull request is not merged automatically, and the next daily run leaves the branch unchanged

#### Scenario: Skipped bundle version
- **WHEN** a bump pull request to `angle-8078.7` is labelled `skip-bump` and closed
- **THEN** later daily runs do not propose `angle-8078.7`, and they propose the next release after it once one exists
