# Design

## Context

`angle/` holds two things. One is the build recipe: `pin.toml`, `args/`, `build.sh`, `build.ps1`, `scripts/`, `smoke/`, `licenses.toml` and `license-texts/`, built by `.github/workflows/angle-build.yml`. The other is the consumer side: `bundles.toml`, which `oxgl-sys/build.rs` downloads from and verifies against, and `README.md`, whose "Known upstream issues" section is cited by the top-level README, `conformance/expectations.txt` and `.github/lsan-suppressions.txt`.

The two are joined at only a few points:

- `build.rs` reads `pin.toml`, but only to warn when its `bundle_version` differs from `bundles.toml`'s.
- `bundle.py` reads the license allowlist from the repository root's `deny.toml`.
- `check_pin.py`, run by `ci.yml`'s `repo-checks`, validates both `pin.toml` and `bundles.toml`.
- The bundles are releases of `jerryryle/oxgl`, tagged `angle-*` and kept from being "Latest".
- `ci.yml`'s `workflow-lint` lints `angle-build.yml`, and `.github/zizmor.yml` has an `artipacked` exception for it.

`ci.yml` has no `paths` filter. `angle-build.yml` runs only for recipe paths. Branch protection therefore can't require both.

## Goals / Non-Goals

**Goals**
- A recipe pull request runs only the ANGLE build, and an oxgl pull request runs only oxgl's CI.
- Each repository has one required check: `ci` in oxgl, `angle-build` in the recipe repository.
- No bundle is rebuilt, and every published digest stays valid.
- In oxgl, a change that only touches documentation or specs runs the cheap checks and skips the build, test, ASan and conformance jobs.

**Non-Goals**
- Changing the bundle format, the platforms, the ANGLE revision, or how bundles are downloaded and verified.
- Automating the oxgl manifest bump from a recipe release.

## Decisions

### Recipe repository `jerryryle/oxgl-angle`, public, `angle/` layout kept

The repository is public because the arm64 smoke jobs use `ubuntu-24.04-arm` and `windows-11-arm`, which are free only for public repositories, as they are for oxgl today. The recipe keeps its `angle/` subdirectory, and a minimal `deny.toml` (just the `[licenses] allow` list) sits at the root. Then `bundle.py`'s `REPO / "deny.toml"`, `REPO / "angle" / ...` and `repo:angle/license-texts/...` paths, and the `angle/build.sh` and `angle/scripts/pin.sh` calls in the workflow, all work unchanged.

Alternative considered: flatten the recipe to the repository root. It is tidier, but it means editing every script path at the same moment the repository moves, with no behaviour gained.

### History moved with `git filter-repo`

`git filter-repo --path angle/ --path .github/workflows/angle-build.yml --path deny.toml` on a fresh clone keeps the five recipe commits with their messages and authors. After the filter, the files that belong to oxgl are removed from the new repository in one commit: `angle/bundles.toml` and everything in `deny.toml` except `[licenses] allow`. The README is rewritten in the same commit (see below).

### Existing bundles copied, not rebuilt

All eleven `angle-8078.2` assets (five bundles, five symbols archives and `SHA256SUMS`) are downloaded from `jerryryle/oxgl` and uploaded unchanged to a new `angle-8078.2` release in the recipe repository. The release uses the `angle-8078.2` tag that `git filter-repo` rewrites along with the history. It points at the filtered copy of the commit oxgl's release was built from (`c35610b`, PR #17), whose recipe files are identical to `016c387`'s, so the tag keeps the real provenance. Creating it through the API would need the `workflow` token scope, because the commit contains a workflow file, so the tag is pushed over git instead. Every file is checked against `SHA256SUMS`, and the bundles and the arm64 symbols archive also against `bundles.toml`. Only the URLs in `bundles.toml` change, so `build.rs` and CI caches keyed by digest notice nothing. The spec's immutability rule allows this: the bytes are identical.

The old releases on `jerryryle/oxgl` stay, so every earlier oxgl commit still builds. Deleting them would break those builds and gain nothing.

### Recipe workflow: always runs, one aggregate check

`angle-build.yml` loses its `paths` filter and runs on every pull request. A first `changes` job diffs the pull request against its base. It uses the same full-history checkout and `git diff` script as oxgl's `changes` job (below); only the matching rule differs. It has two outputs:

- `recipe`: true when any path from today's recipe filter changed, other than the workflow file itself.
- `build`: true when `recipe` is true or `.github/workflows/angle-build.yml` changed.

A failed diff sets both to true. On `workflow_dispatch` both are true.

Jobs and their conditions:

- `guard` runs only when `recipe` is true.
- `build` needs `[changes, guard]`. It runs when `build` is true and `guard` succeeded or was skipped: `!cancelled() && needs.changes.outputs.build == 'true' && contains(fromJSON('["success","skipped"]'), needs.guard.result)`.
- `smoke` needs `build` and runs only when `build` succeeded: `!cancelled() && needs.build.result == 'success'`. A job reads only its direct `needs`, so it can't reuse `build`'s condition. It skips exactly when `build` skipped.
- `release` stays `workflow_dispatch`-only.
- A final `angle-build` job runs with `if: always()` and needs every job. It uses the same rule as oxgl's aggregate: `changes` and `workflow-lint` must succeed, and every other job must succeed or have a legitimate skip. A skip is legitimate for `guard` only when `recipe` is false, for `build` and `smoke` only when `build` is false, and for `release` on any pull request. Any other skip fails the check, so a broken `if:` expression can't silently pass an untested recipe.

Branch protection on the recipe repository's `main` requires `angle-build` (plus `workflow-lint`, folded into the aggregate).

Splitting `recipe` from `build` is what lets Dependabot's action bumps merge. A pull request that only edits the workflow still builds and smoke-tests every bundle, so the edit is proven, but `guard` does not demand a new `bundle_version`. No release comes from a pull request, so nothing published is rebuilt. Documentation-only pull requests skip everything. Without the `changes` job, `guard` would fail both kinds, because `bundle_version` is already released.

The recipe repository gets a `workflow-lint` job (actionlint and zizmor, at the versions oxgl pins) and a Dependabot config for actions on a monthly schedule. Each action-bump pull request builds all five bundles, so weekly bumps would cost hours of runner time a week in a repository whose recipe rarely changes. The `artipacked` exception moves to the recipe repository's `.github/zizmor.yml` with the workflow. The workflow gets `persist-credentials: false` in the repository's initial push, which needs no pull request and so no build, and the exception is dropped instead of moved.

### oxgl CI: skip heavy jobs for changes that can't affect them

A `changes` job runs first and outputs `heavy=true|false`.

- **Which files changed:** for a pull request it diffs `base.sha...head.sha`; for a push to `main` it diffs `before..sha`. It uses a full-history checkout with `persist-credentials: false`; oxgl's history is small.
- **The rule:** `heavy` is false only when every changed path matches the skip list. The list is kept in the job as a shell `case`:
  - `*.md`
  - `openspec/*`
  - `.claude/*`
  - `LICENSE`
  - `.editorconfig`
  - `.github/dependabot.yml`
  - `.github/zizmor.yml`
  - `.github/actionlint.yaml`
- **Fails safe:** an all-zero `before` (a new branch), a failed diff or an empty file list gives `heavy=true`.

`check`, `node-range`, `asan` and `conformance` need `changes` and carry `if: needs.changes.outputs.heavy == 'true'`. `gpu` adds the same condition to its existing variable check. `workflow-lint` and `repo-checks` don't depend on it.

The aggregate keeps `if: always()`. Its `jq` check changes from "every need succeeded" to:

- `changes`, `workflow-lint` and `repo-checks` succeeded, and
- each heavy job either succeeded, or was skipped while `heavy` was false.

A failed `changes` job leaves the heavy jobs skipped with `heavy` unset, so `ci` fails, as the spec's existing "Skipped required job" scenario requires.

Why it is built this way:

- **A skip list, not an allow-list of code paths.** A new directory, config file or script runs everything until someone deliberately lists it. The list holds only files nothing reads during build, lint or test. `bench/` is not on it, because ESLint lints it in `check`. Neither are `deny.toml` and `THIRD_PARTY_NOTICES`: `build.rs` reads `deny.toml`, and `repo-checks` covers both anyway.
- **Inline shell, not `dorny/paths-filter`.** About fifteen lines of shell avoid another third-party action with repository-read access, for a rule this small.
- **Pushes to `main` are gated too.** The only things a docs-only push to `main` would feed are the caches PRs restore. Those are keyed by `Cargo.lock`, the toolchain, the suite pin and `bundles.toml`, none of which are on the list, so a skipped push leaves the caches current.
- **One list for all heavy jobs.** Per-job lists (for example, conformance only for `crates/` and `src/`) would save more but need a list per job to maintain. That is left as an extension point.

The recipe repository's `changes` job uses the same mechanism with the opposite rule: it builds only when a recipe path or the workflow changed. That is safe there, because a recipe change is defined by today's explicit path list.

### oxgl keeps `angle/` for the consumer side

`angle/bundles.toml` and a rewritten `angle/README.md` stay. The README keeps the bundle layout, "How oxgl-sys finds a bundle" and "Known upstream issues" verbatim. "Building locally" and "Changing ANGLE" become a short pointer: build and release in `oxgl-angle`, then update `bundles.toml` here. Keeping the path means `build.rs`, the top-level README, `conformance/expectations.txt`, `.github/lsan-suppressions.txt` and the `angle-known-issues` memory keep pointing at the right place.

### Checks split by repository

- `check_pin.py` splits. The `pin.toml` checks move to the recipe repository as `angle/scripts/check_pin.py`, run in its `workflow-lint` job, and gain no new rules. oxgl keeps `angle/scripts/check_pin.py` at its current path and name, so `ci.yml`, `CONTRIBUTING.md` and its usage line need no edits. Its `pin.toml` checks are removed. It checks `bundles.toml` keys, digests and the `symbols_*` pair as today, and requires every URL to start with `https://github.com/jerryryle/oxgl-angle/releases/download/<bundle_version>/`. `--allow-unpublished` goes away: the manifest only ever names published bundles now.
- `build.rs` stops reading `pin.toml`. Its version-mismatch warning and the `version()` helper, which only that warning used, go with it. `bundles.toml`'s `bundle_version` stays as the record of which recipe release it pins. `check_pin.py` reads it to check the URLs, and `build.rs` doesn't need it.

### Coordination with `linux-arm64-focus`

That change is open and stays open until the end of the arm64 focus. Its delta MODIFIES "ANGLE revision is pinned in the repository" with the pre-split text. Archiving it later would therefore overwrite this change's version of that requirement. This change updates that delta's block to the text in this change's spec. That change's remaining angle-distribution blocks don't conflict. Its "Platform matrix" block in `continuous-integration` says the ANGLE build workflow is unaffected. After this change there is no such workflow in oxgl, so that phrase is dropped. Its other CI blocks don't touch "Triggers" or "Aggregate status check".

### Safety rules

The only Rust edit is deleting the `pin.toml` read in `oxgl-sys/build.rs`. It adds no `unsafe` code and no `unwrap`, `expect` or `panic!`: the remaining code keeps its `Result` error path. Handles, ArrayBuffers and the runtime library are untouched.

## Risks / Trade-offs

- Changing ANGLE becomes two pull requests in two repositories. → The recipe release's job summary already prints the digests to paste into `bundles.toml`, and the README describes both steps.
- The license allowlist exists twice. → If the recipe's copy grows wider than oxgl's, oxgl's `build.rs` re-check fails the native build and names the component (angle-distribution, "Bundle licenses are on the project allowlist"). If the copy is narrower, the recipe build fails early. Neither can let a disallowed license through.
- A file wrongly added to the skip list lets a breaking change merge untested. → The list holds only file kinds no tool reads. Adding to it is a reviewed change to `ci.yml`, and that change itself runs every job, because `ci.yml` is not on the list.
- Tool versions (actionlint, zizmor, Python) are pinned in two places. → They drift harmlessly; Dependabot bumps the actions in each repository.

## Migration Plan

1. Create the recipe repository from the filtered history, add its workflow changes, and set branch protection.
2. Copy the `angle-8078.2` assets into its release and verify the digests.
3. In oxgl, in one pull request: point `bundles.toml` at the new URLs and remove the recipe files and `angle-build.yml`. Then split the checks, update `build.rs`, the README, `CONTRIBUTING.md` and zizmor, add the `changes` gating to `ci.yml`, and update `linux-arm64-focus`'s delta. Full `ci` runs on it, because `bundles.toml` changed.
4. Roll back by reverting the oxgl pull request. The old URLs still work.

## Open Questions

None. The repository name `oxgl-angle` is an assumption from the proposal. Changing it only changes the URL prefix.
