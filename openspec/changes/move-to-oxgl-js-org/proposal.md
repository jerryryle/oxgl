# Proposal

## Why

oxgl and oxgl-angle are moving from the personal account `jerryryle` to the free GitHub organization `oxgl-js`, because merge queues exist only for organization-owned repositories and the coming CI overhaul is built on them. After the transfer, every place that names `jerryryle/oxgl` or `jerryryle/oxgl-angle` must name `oxgl-js` instead: npm rejects a publish whose `repository` field doesn't match the provenance, so the next release fails until `package.json` changes. The other references, bundle URLs included, keep working through GitHub's redirect, which lasts only until a repository with the old name exists. They change now so nothing depends on it.

## What Changes

- The specs name `oxgl-js/oxgl-angle` as the recipe repository and `oxgl-js/oxgl` as the repository named in provenance and linked from the results page.
- `package.json`'s `repository`, `homepage` and `bugs` fields point at `oxgl-js/oxgl`.
- `angle/bundles.toml` URLs, the pin check's accepted release prefix and the bump script's repository move to `oxgl-js/oxgl-angle`. The bundles and their SHA-256 digests don't change.
- Links in the README (including the CI badge), CONTRIBUTING (including the trusted-publisher step), `angle/README.md`, the platform package README, the results page and its tests, the bump PR body, and `oxgl-sys`'s missing-bundle message point at `oxgl-js`.
- In oxgl-angle (which has no OpenSpec), the README's link to oxgl points at `oxgl-js/oxgl`.
- **BREAKING (URL only):** the results page moves from `https://jerryryle.github.io/oxgl/` to `https://oxgl-js.github.io/oxgl/`. GitHub doesn't redirect Pages sites after a transfer.

Out of scope:
- The CI overhaul and merge-queue setup. That's the next change, and this one leaves `ci.yml`'s structure and jobs as they are.
- The repository transfers, organization settings and npm trusted-publisher edits. These are manual steps; `tasks.md` lists them in order as prerequisites, but they aren't code.
- The Illustrator repo cards in `assets/`, the `jerryryle` user login in `angle/scripts/test_bump.py`'s fixtures (it names a person, not a repository), and archived changes, which keep the names they had.
- A redirect from the old Pages URL. Its only possible home is a `jerryryle.github.io` user-site repository, which is left to later work if it turns out to be wanted.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `angle-distribution`: the recipe repository is `oxgl-js/oxgl-angle`.
- `release`: provenance names `oxgl-js/oxgl`.
- `results-page`: the page links to `https://github.com/oxgl-js/oxgl`.

## Impact

- **Code:** `package.json`, `angle/bundles.toml`, `angle/scripts/bump.py`, `angle/scripts/check_pin.py`, `crates/oxgl-sys/build.rs` (a message string), `scripts/results-page.mjs`, `scripts/results-page.html`, `test/results-page.test.mjs`, `.github/workflows/angle-bump.yml` (the PR body text).
- **Docs:** `README.md`, `CONTRIBUTING.md`, `angle/README.md`, `scripts/platform-README.md`. In oxgl-angle, `README.md`.
- **External systems:** the npm trusted publishers of the six `@oxgl-js/*` packages, the GitHub Pages URL, and anyone's clones and bookmarks. GitHub redirects git, web and API URLs; it doesn't redirect Pages.
- **Releases:** no version bump. The next release after the transfer must come from a commit that includes this change.
