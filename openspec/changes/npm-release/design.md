# Design

## Context

- **How a build is laid out today.** `npm run build` writes the addon (`dist/oxgl.<platform>.node`), napi's loader (`dist/native.cjs`), the host's ANGLE libraries (`dist/angle/`) and `dist/THIRD_PARTY_NOTICES` into `dist/`. `src/native.ts` loads `./native.cjs` and passes `dist/angle/` to `native.init`. `oxgl-sys`'s loader requires that directory to be absolute. `package.json` is `private`, and its `files` list publishes all of `dist/`.
- **How CI is set up.** `ci.yml`'s `check` job already builds and tests the release build on all five platforms. Branch protection on `main` (the "Default (bypassable)" ruleset) requires the aggregate `ci` check, with strict up-to-date branches and squash merges only. It requires no approving review. Tags are not protected.
- **The pattern to copy.** oxgl-angle already bumps ANGLE without anyone doing anything: `angle-bump.yml` opens a pull request with the default token and dispatches the build on the branch. A `merge-bump` job merges the pull request when it passes and is exactly the bot's change. Pushes, pull requests and merges made with the default token start no workflows, so each step dispatches the next one explicitly.
- **What exists on npm.** The `npm` GitHub environment exists, and only `main` can deploy from it. The package name `oxgl` is unclaimed on npm. The `oxgl` org name was taken, so the platform packages use the `oxgl-js` org (scope `@oxgl-js`), which the maintainer has created.

## Goals / Non-Goals

**Goals:**
- One mechanism releases both human and bot changes: a version on `main` that npm doesn't have yet.
- Published bytes are bytes that CI installed and ran.
- No long-lived npm credential exists anywhere.

**Non-Goals:**
- Rebuilding for the release, or publishing from a pull request or a tag push.
- Recovering automatically from a release that fails partway. A rerun of the job completes it (release spec).
- Any change to Rust code. The addon and its loader are unchanged.

## Decisions

### D1. Trigger releases on a version change, not on every push or on tags
The release job publishes when `package.json`'s version isn't on npm.
- **Why not every push:** it would publish docs and spec commits, and it would need computed versions plus a commit written back to `main`.
- **Why not release-please or changesets:** either adds a tool and a standing release PR that a single maintainer doesn't need.
- **Why not tag-triggered publishing:** it splits "what was tested on `main`" from "what was published", and the tag push would need its own CI run.

A version bump always changes `package.json`, which is not on the skip list. So a run that has a release to make always builds and packs; it never skips the heavy jobs.

### D2. Platform packages under `@oxgl-js`, resolved by `src/native.ts`
napi's generated loader names platform packages `<packageName>-<triple>`, so it can't produce `@oxgl-js/linux-arm64-gnu`. `src/native.ts` therefore resolves the addon itself:
- **The platform string:** derived as napi derives it, with no table: `${process.platform}-${process.arch}`, plus `-gnu` on Linux and `-msvc` on Windows. That gives the file `oxgl.<platform>.node` and the package `@oxgl-js/<platform>`, the same names `pack.mjs` derives from `napi.targets`, so `napi.targets` stays the only platform list.
- **The musl check:** only on the failure path, to word the error. `process.report.getReport().header.glibcVersionRuntime` is undefined on musl, but building the report is expensive, so a normal import never builds it.
- **The candidates, in order:** `dist/` (a local build), then the platform package's directory, found with `require.resolve('<pkg>/package.json')`.
- **The choice:** the first directory that holds both `oxgl.<platform>.node` and an `angle/` directory provides the addon and ANGLE. Checking for `angle/` here matters because `native.init` only records the directory and ANGLE loads on the first context creation: without the check, a package missing its libraries would import cleanly and fail later. `angle/` is resolved to an absolute path, as `oxgl-sys`'s loader requires.
- **When nothing is found:** the existing `OXGL_NATIVE_MISSING` error. On this failure path only, native.ts reads its own package's `optionalDependencies`, which `pack.mjs` writes from `napi.targets`, to tell the cases apart:
  - The derived package is listed but not installed: the message names it.
  - It isn't listed (such as `linux-ia32-gnu`), or the host is musl: the message says there's no build for that host.
  - A local checkout has no `optionalDependencies`: the message says to run `npm run build`.

`build:native` stops emitting `native.cjs` (`--no-js`). Each platform package's layout mirrors `dist/`: the `.node` file, `angle/`, `THIRD_PARTY_NOTICES`, `LICENSE` and a manifest.

**No checked-in platform manifests.** `scripts/pack.mjs` generates each manifest when it packs:
- **The name:** `@oxgl-js/<platform>`, where `<platform>` is napi's platform-arch-abi string for the host's triple in `napi.targets` (for example `linux-arm64-gnu`, `darwin-arm64` or `win32-x64-msvc`). That string is also the addon's file suffix.
- **The constraints:** `os`, `cpu` and `libc`, derived from the same triple.
- **Everything else:** the root's version, license and repository.

`napi.targets` stays the only list of platforms. Alternative considered: `napi create-npm-dirs`, which writes the same manifests but names them `<packageName>-<platform>`, so it can't produce `@oxgl-js/<platform>`.

**`optionalDependencies` exist only in the published `oxgl` manifest.** `scripts/pack.mjs` packs `oxgl` from a staging copy of the root package whose manifest gains `optionalDependencies` on all five platform packages, at exactly the root version. The repository's `package.json` never lists them, because a lockfile can't record a package that isn't published yet. npm 11.20 confirms this:
- `npm ci` fails with `EUSAGE` ("Missing: … from lock file") when `package.json` lists an optional dependency the lockfile couldn't resolve.
- `npm install` of a tarball whose optional dependencies return 404 succeeds and installs the rest.

So a version bump touches only `version` in `package.json` and `package-lock.json`.

Alternative considered: naming the packages `@oxgl-js/oxgl-<triple>` to keep napi's loader. That gives uglier names, and the ANGLE directory still has to be found separately.

### D3. Packing and smoke-testing in `check`, publishing in a separate job
- **In `check`, after `npm test`:** `scripts/pack.mjs` stages `dist/`'s platform files with the generated manifest (D2) and runs `npm pack` there. It also packs the staged root copy. A root `files` list keeps the `.node` file and `angle/` out of `oxgl`.
- **The smoke test:** `npm install --ignore-scripts` both tarballs into a fresh directory under `$RUNNER_TEMP`, then run a short script that renders with `backend: 'software'`. It must be `npm install`, not `npm ci`: the other four platform packages at an unpublished version return 404, and `npm install` skips them (D2).
- **Whether this run releases:** the `changes` job gains a `release` output. It is `true` only on `refs/heads/main` when `npm view oxgl@<version>` fails, meaning the version isn't published yet. This is the same query the release would make, done once per run.
- **Uploads:** only when `release` is `true`, each leg uploads its platform tarball as `packages-<os>`, kept for 7 days to cover reruns.
- **Where `oxgl` comes from:** only the `ubuntu-24.04-arm` leg also uploads its root tarball, which every leg packs and smoke-tests for itself. So the release has exactly one `oxgl` tarball and no same-named files to collide, even when it downloads every artifact into one directory. The bytes can differ between legs (npm pack records file modes differently on Windows), so the choice must not depend on download order.

The `release` job has `needs: [changes, check, ci]`, since a job reads only its direct needs. It runs only when `changes.outputs.release == 'true'` and both `check` and `ci` succeeded, so a push without a version bump never starts it.
- **Setup:** it has `environment: npm`, `permissions: id-token: write, contents: write`, and `concurrency: npm-release` with no cancelling, which serializes overlapping `main` runs. It uses no caches and checks out with `persist-credentials: false`. It uses the npm bundled with Node 24: OIDC trusted publishing needs npm 11.5.1 or later, which Node has bundled since 24.5.0 (24.22.2 ships 11.19.1). Installing a pinned npm instead would be an install outside the lockfile, which zizmor's `adhoc-packages` audit flags.
- **Steps:**
  1. Read the version.
  2. For each platform tarball, then `oxgl`: skip it if `npm view <name>@<version>` succeeds, otherwise `npm publish <tgz> --provenance --access public`.
  3. Unless the GitHub Release `v<version>` already exists, run `gh release create v<version> --target $GITHUB_SHA --generate-notes`, which also creates the tag.

There's no check for a tag on another commit: the only way to get one is to tag a version by hand before CI releases it. If that happens, `gh release create` uses the existing tag. That's accepted (see Risks).

**The cache trade-off:** the published binaries come from jobs that restore Cargo and ANGLE caches. Entries visible to `main` runs can only be written by `main` runs, so poisoning one requires code already on `main`. That doesn't widen access beyond what `main` already grants. zizmor's cache-poisoning audit may still flag it, and any ignore it needs gets this justification in `.github/zizmor.yml`.

### D4. The ANGLE bump copies oxgl-angle's flow, with the bump script in `angle/scripts/`
`angle-bump.yml` runs daily at 10:17 UTC, three hours after oxgl-angle's 07:17 bump, and on `workflow_dispatch`. An oxgl-angle bump builds twice, once on its branch and once on `main`, at about 30 to 50 minutes each (its recent runs), so it releases within about 1h40m. Three hours leaves margin, and oxgl picks up a new ANGLE the same day.
- **Finding a release:** `angle/scripts/bump.py [<tag>]` pins the given oxgl-angle release, or by default the latest one, read with `gh release view --repo jerryryle/oxgl-angle`. If it differs from `bundle_version`, it downloads that release's `SHA256SUMS` and rewrites `bundles.toml`'s version, URLs and digests, including the symbols archives. It then runs `check_pin.py`. Python, because `check_pin.py` already parses that file.
- **Where the release came from:** before pinning, `bump.py` refuses a release unless all of these hold:
  - It was created by `github-actions[bot]`.
  - Every asset, `SHA256SUMS` included, was uploaded by `github-actions[bot]` (each asset's `uploader.login`). A token can replace an asset without changing the release's author, so checking the author alone isn't enough.
  - Its tag points at a commit on oxgl-angle's `main`, checked with the compare API: the commit is `behind` or `identical`.

  The first two come from the release metadata `gh` already fetches; the third is one compare-API call. `merge-bump` reruns `bump.py`, so the check runs again before the merge.
- **Why the origin check:** the bump replaces the person who used to copy digests from oxgl-angle's release run, and CI only checks the downloads against the release's own `SHA256SUMS`. Without a check, anyone who can create a release in oxgl-angle could ship binaries to npm. With it, only oxgl-angle's own workflows can, and those run from code already on its `main`. A personal token, even a leaked one, creates releases and uploads assets under its owner's name, not the bot's, so a release it made or an asset it replaced is refused. What remains is listed under Risks.
- **Before the first release:** the workflow does nothing while `npm view oxgl` reports no published version at all. Until the bootstrap (Migration Plan) is done, a bump can't be released, and merging one would only change what `0.1.0` contains. This reuses the registry query the version step already makes.
- **The version:** the workflow then runs `npm version patch --no-git-tag-version`, which updates `package-lock.json` too, unless `npm view oxgl@<current>` fails, meaning the current version isn't released yet.
- **The PR:** it commits with the subject `Pin oxgl-angle <tag>`, force-pushes `angle-bump`, opens or edits the PR, and runs `gh workflow run ci.yml --ref angle-bump`.
- **Leaving branches alone:** a branch carrying other commits, a `skip-bump` label and closing stale bumps all follow oxgl-angle's `angle-bump.yml`.

`ci.yml` gains a `merge-bump` job:
- **When it runs:** it needs `ci` and runs only for `workflow_dispatch` on `refs/heads/angle-bump` when `ci` succeeded. It has `contents`, `pull-requests` and `actions` write permissions.
- **What it checks:** it reads the tag from the head commit's subject (`Pin oxgl-angle <tag>`). It then reruns `main`'s copy of `bump.py <tag>` and the version step on `main`'s tree, and compares the result with the branch head: the three files, and no other changed path. If they differ, or the subject isn't the bot's, it leaves the PR for a person with a notice.
- **Why the tag comes from the commit:** the release is the one CI tested. A newer oxgl-angle release published during the hours-long CI run therefore doesn't block the merge; it becomes the next day's bump. oxgl-angle's `merge-bump` reads its Chrome version from the commit for the same reason.
- **What it does:** `gh pr merge angle-bump --squash --match-head-commit $GITHUB_SHA`, then `gh workflow run ci.yml --ref main`. The run on `main` releases.

### D5. `workflow_dispatch` on `ci.yml`
A manual run has no comparable range, so the `changes` job already reports `heavy=true` for it. The `ci` check run lands on the dispatched commit, and that's the check the ruleset requires on the bump PR.

The concurrency group becomes `ci-${{ github.ref == 'refs/heads/main' && github.run_id || github.ref }}`:
- **Off main:** pull requests and manual runs on any other branch share a group per ref and cancel their predecessor. When the daily bump refreshes `angle-bump`, the previous run, which `merge-bump`'s `--match-head-commit` would refuse anyway, stops using runners.
- **On main:** every run keeps its own group, so no commit on `main` is skipped.

### D6. Linux packages need glibc 2.34, and CI holds them to it
Built on the Ubuntu 24.04 runners, the addon needs `GLIBC_2.34` (measured with `objdump -T` on Linux arm64), while the ANGLE libraries need only `GLIBC_2.17`. So the Linux packages run on glibc 2.34 or newer: Ubuntu 22.04, Debian 12, RHEL 9, Amazon Linux 2023 and later.
- **The check:** after packing, the Linux `check` legs read every `GLIBC_` symbol version each library in the platform package needs, and fail if any is newer than 2.34. The 2.34 comes from the runner image, so a move to a newer image would otherwise raise the requirement without anyone noticing.

Alternative considered: linking against an old glibc with napi-rs's `--use-napi-cross` toolchain. It was tested and works: the addon needed only `GLIBC_2.17`, the tests passed, and the package rendered on Debian 11. It was rejected as more than the need: an experimental toolchain downloaded at build time and a separate build command on the Linux legs, to reach glibc 2.31–2.33 systems (mainly Ubuntu 20.04 and Debian 11), which are past their standard support.

## Safety rules

This change touches no Rust code, so the unsafe confinement, no-panic, handle and ArrayBuffer-lifetime rules don't change. The only runtime change is in `src/native.ts`:
- It passes an absolute ANGLE directory, as `oxgl-sys`'s loader already requires.
- Every failure becomes the existing `OXGL_NATIVE_MISSING` error.

## Risks / Trade-offs

- **[A new ANGLE regresses something the tests don't cover, and it publishes automatically]** → The bump runs the full CI: five platforms, ASan, and both conformance suites. That's the bar every human change meets too. A bad version is fixed by a later version, since npm versions can't be replaced.
- **[A release fails partway, so npm has some packages of a version]** → Platform packages go first and `oxgl` last, so no published `oxgl` points at a missing platform package. Rerunning the job completes the release (release spec).
- **[The tag or GitHub Release is missing after a publish]** → Rerunning the job skips the published packages and creates the tag and the release.
- **[The first release can't use OIDC]** → npm only lets you add a trusted publisher to a package that already exists. The bootstrap is in the migration plan below. `0.1.0` has no provenance as a result.
- **[Someone who can change oxgl-angle's `main` or run its workflows ships a tampered bundle]** → Accepted. The origin check (D4) stops releases made outside oxgl-angle's workflows, but not a workflow that has itself been compromised. A stronger check, verifying build-provenance attestations of the bundles, needs oxgl-angle to attest them first, so it's left for later.
- **[The bump can't open its pull request]** → The default token can open pull requests only when the repository allows it. jerryryle/oxgl has that setting off today (`can_approve_pull_request_reviews: false`), so turning it on is migration step 1.
- **[The bot merge is blocked by the ruleset]** → The ruleset requires no review, and the default token can merge once `ci` passes. If `main` moved, the strict up-to-date rule blocks the merge, and the next daily run refreshes the bump.
- **[A person tags `v<version>` by hand on a different commit before CI releases that version]** → Accepted. The GitHub Release attaches to the hand-made tag, and the published packages' provenance still names the commit they were built from. Fix it by moving the tag.
- **[Linux systems with glibc older than 2.34 can't use the package]** → Accepted: they get `OXGL_NATIVE_MISSING`-style load errors naming the missing `GLIBC_` version. Mainly Ubuntu 20.04 and Debian 11, both past standard support. Linking against an old glibc (D6's alternative) is the way back if that changes.
- **[Artifacts expire before a rerun]** → Retention is 7 days. After that, a rerun of the whole workflow on `main` rebuilds and republishes the missing packages.

## Migration Plan

1. Before merging, the maintainer turns on "Allow GitHub Actions to create and approve pull requests" in jerryryle/oxgl's Actions settings. oxgl-angle already has it on. Without it, the bump's `gh pr create` fails with the default token.
2. Merge the change with the version at `0.1.0`. The `main` run packs and smoke-tests, and then its `release` job fails because no trusted publisher exists yet. Until step 3 is done, the daily ANGLE bump does nothing (D4), so `main` stays at the merged pin.
3. The maintainer downloads that run's `packages-*` artifacts, and runs `npm publish <tgz> --access public` for the five platform tarballs and then `oxgl`.
4. On each of the six packages' settings pages, the maintainer adds a trusted publisher:

   | Field | Value |
   |---|---|
   | Owner | `jerryryle` |
   | Repository | `oxgl` |
   | Workflow | `ci.yml` |
   | Environment | `npm` |

   Then they set "Require 2FA and disallow tokens".
5. Rerun that run's `release` job. It finds all six packages published and creates `v0.1.0` and its GitHub Release.
6. From then on, a version bump or an ANGLE bump releases without anyone doing anything.

Rollback: remove the `release` and `merge-bump` jobs and disable `angle-bump.yml`. Published versions stay; deprecate one with `npm deprecate` if needed.
