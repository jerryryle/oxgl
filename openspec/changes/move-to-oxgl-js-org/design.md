# Design

## Context

This change spans two repositories and three outside systems (GitHub, npm and GitHub Pages), and the order of steps matters. The constraints that set the order:

- After a transfer, GitHub redirects git, web, API and release-download URLs from the old owner, but not Pages URLs. The redirect lasts until someone creates a repository with the old name under `jerryryle`.
- `check_pin.py` compares each bundle URL in `angle/bundles.toml` against a fixed release prefix as text. It never fetches the URL, so changing the prefix and the URLs together keeps the check consistent before and after the transfer.
- npm rejects a provenance publish when `package.json`'s `repository.url` doesn't match the repository in the provenance, and when the package's trusted publisher names a different owner.
- oxgl's `angle-bump.yml` bumps `version`, and a merged version bump releases. While the repository fields and the npm trusted publisher disagree with the actual repository, a release fails at npm.

## Goals / Non-Goals

**Goals:**
- Every live reference to either repository names `oxgl-js`. A `git grep jerryryle/` outside archived changes, this change's own directory, the `.ai` repo cards and `test_bump.py`'s user-login fixtures finds nothing.
- No release is attempted while the repository and npm disagree.

**Non-Goals:**
- Changing how CI or a release works. The CI overhaul comes next.

## Decisions

- **One edit per repository, merged after both transfers.** oxgl's PR goes up and merges once both repositories are in `oxgl-js`. That way its CI runs in the new repository, and bundle URLs under `oxgl-js/oxgl-angle` already resolve directly. Merging before the transfer is the alternative: it would work only through redirects that don't exist yet (the new URLs would 404), so the bundle download would fail.
- **Keep the daily bumps disabled from just before the transfer until this change and the trusted-publisher edits are in.** That's the simplest way to keep a release from starting in the gap. The alternative is making the release job check the npm configuration, which adds machinery for a window that lasts minutes.
- **Change `bundles.toml` URLs without rebuilding or re-recording digests.** The release assets are the same files under the new owner, so the existing SHA-256 digests still apply. The bundle download step verifies them, so a wrong guess about that fails CI instead of passing silently.
- **Leave `test_bump.py`'s `jerryryle` fixtures as they are.** They stand for a human who isn't `github-actions[bot]`, not for a repository owner.
- **No redirect for the old results page.** A `jerryryle.github.io` user-site repository with a redirect page would bring the old link back, but it's a third repository to maintain for one link. Left out unless asked for.

No safety rule is involved: the only Rust edit is the text of an error message in `oxgl-sys`'s build script, and no `unsafe` code, handles or buffers change.

## Risks / Trade-offs

- [The old results-page URL 404s after the transfer] → Accepted. README, CONTRIBUTING and the platform READMEs link to the new URL. Links elsewhere, such as in already-published npm READMEs, break.
- [Already-published npm versions keep provenance and repository links naming `jerryryle/oxgl`] → Accepted. GitHub's web redirect keeps the links working, and provenance records where a version was really built.
- [A daily bump runs between the transfer and this change landing] → The bumps stay disabled for that window (task 1.1). If one runs anyway, its release fails at npm without publishing anything: `scripts/pack.mjs` copies the root `repository` field into every platform package, so all six fail the provenance check. Rerunning that job doesn't help, because it reuses the run's packages, which carry the old field. No action is needed: the run on `main` for this change's merge finds that version unpublished and releases it from packages that carry the new field.

## Migration Plan

`tasks.md` holds the order: the manual steps (group 1) come before the edits, and re-enabling the bumps (task 5.2) comes after both PRs merge.

Rollback: transfer the repositories back, set the six npm trusted publishers' owner back to `jerryryle`, and revert this change's commits. GitHub redirects the URLs in the other direction.
