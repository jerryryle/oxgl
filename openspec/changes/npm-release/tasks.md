# Tasks

## 1. Platform packages and addon resolution

- [x] 1.1 In the root `package.json` (edit in place, keep `@fission-ai/openspec`):
  - Drop `private` and set `version` to `0.1.0`.
  - Narrow `files` to the JS, the type declarations and `LICENSE`.
  - Add `repository`, `homepage` and `bugs`.
  - Add no `optionalDependencies`: they exist only in the packed `@oxgl-js/oxgl` manifest (design D2).

  Verify that `npm pack --dry-run` at the root lists no `.node` file and nothing under `angle/`, and that `npm ci` still succeeds.
- [x] 1.2 Make `build:native` pass `--no-js`, and make `src/native.ts` resolve the addon as design D2 describes:
  - Look in `dist/` first, then in the platform package's directory.
  - Pass that directory's absolute `angle/` path to `native.init`.
  - On failure, throw `OXGL_NATIVE_MISSING` naming the missing package, or that musl has no build.

  Derive the platform string as design D2 describes, with no table, and run the musl check only on the failure path. Add Node tests, with the host and package lookup injected, that cover:
  - local precedence;
  - that a directory holding the `.node` file but no `angle/` is not chosen, and import fails with `OXGL_NATIVE_MISSING`;
  - the derived names for all five `napi.targets` entries, which must match `pack.mjs`'s;
  - the messages for a listed-but-missing package, a host with no build (`linux-ia32`), a musl host, and a checkout with no `optionalDependencies`;
  - that a successful import never calls `process.report.getReport`.

  Verify that `npm run build`, `npm test` and `npm run lint:js` pass on macOS arm64.
- [x] 1.3 Add `scripts/pack.mjs` (design D2, D3). It writes both tarballs to one output directory:
  - **Platform package:** it stages `dist/`'s platform files and `LICENSE` with a generated manifest. The manifest's name is `@oxgl-js/<platform>`, with `os`, `cpu`, `libc` (Linux), `files`, `license`, `repository` and `publishConfig.access: public` derived from the host's triple in `napi.targets`, and the root version. It runs `npm pack` there.
  - **`@oxgl-js/oxgl`:** it packs a staged copy of the root package whose manifest gains `optionalDependencies` on every platform in `napi.targets` at exactly the root version.

  Verify locally that:
  - The platform tarball lists `oxgl.darwin-arm64.node`, `angle/`, `THIRD_PARTY_NOTICES` and `LICENSE`, and its manifest declares `os: ["darwin"]` and `cpu: ["arm64"]`.
  - The `@oxgl-js/oxgl` tarball's manifest lists the five platform packages at the root version, while the repository's `package.json` is unchanged.
  - `npm run lint:licenses` still passes.
- [x] 1.4 Add `scripts/smoke-packed.mjs`. It creates an empty project in a temporary directory, installs the two tarballs with `npm install --ignore-scripts`, and runs a script that imports `@oxgl-js/oxgl` from there. That script asserts that `@oxgl-js/oxgl` resolves inside the temporary `node_modules`, creates a `backend: 'software'` context, clears it and reads back the clear color. Verify that it passes on macOS arm64 at an unpublished version, where the other four platform packages return 404 and `npm install` skips them. Also verify that it passes on Linux arm64 in a `linux/arm64` Docker container (CLAUDE.md), and that it fails with `OXGL_NATIVE_MISSING` when `angle/` is removed from the platform tarball's file list.

## 2. CI: manual trigger, packed-package smoke test, release

- [ ] 2.1 In `ci.yml`:
  - Add the `workflow_dispatch` trigger, and change the concurrency group as design D5 specifies.
  - Give `changes` the `release` output (design D3).
  - Add steps to `check` after `npm test`: run `scripts/pack.mjs` and `scripts/smoke-packed.mjs`, and when `release` is `true`, upload the platform tarball as `packages-<os>` with `retention-days: 7`, plus the `@oxgl-js/oxgl` tarball from the `ubuntu-24.04-arm` leg only (design D3).

  Update the `continuous-integration` docs in `CONTRIBUTING.md`'s job table. Verify:
  - A pull request run is green on all five platforms and uploads no packages, and actionlint and zizmor pass. If zizmor flags cache poisoning, the ignore carries design D3's justification.
  - `gh workflow run ci.yml --ref <branch>` reports the `ci` check on that branch's head commit.
  - A second dispatch on the same branch cancels the first.
- [ ] 2.2 Add `scripts/release.mjs`, which takes a directory of tarballs and a `--dry-run` flag:
  1. It skips packages npm already has at the version.
  2. It publishes the platform packages before `@oxgl-js/oxgl` with `--provenance --access public`.
  3. Unless the GitHub Release exists, it creates the tag and the Release with `gh release create --generate-notes --target`.

  Add the `release` job to `ci.yml` as design D3 specifies (`needs: [changes, check, ci]`, run only when `release` is `true` and `check` and `ci` succeeded, `environment: npm`, `id-token: write`, `contents: write`, `concurrency: npm-release`, Node 24's bundled npm, ≥ 11.5.1, no caches). Verify:
  - With `--dry-run` against a scratch run's tarballs, it reports publishing all six packages in platform-then-`@oxgl-js/oxgl` order, and the `@oxgl-js/oxgl` tarball it reports is the `ubuntu-24.04-arm` leg's.
  - It reports nothing to publish when pointed at a version that exists on npm.
  - The `release` job is skipped on a pull request run, and actionlint and zizmor pass.
- [x] 2.3 Add the `merge-bump` job to `ci.yml` as design D4 specifies. Verify with actionlint and zizmor. Also verify that its "exactly the bot's change" check, run locally against a bump branch made by task 3.1's script, accepts it unchanged, also after a newer oxgl-angle release exists (the tag comes from the commit subject), and rejects it with one extra commit or one extra changed file.
- [x] 2.4 After the pack step on the Linux `check` legs, fail if any library in the platform package needs a `GLIBC_` version newer than 2.34, naming the library and the version (design D6). Verify locally in a `linux/arm64` Docker container (CLAUDE.md) that the check passes on today's packed Linux arm64 package and fails, naming the addon, with the limit lowered to 2.33. Verify that actionlint and zizmor pass.
- [x] 2.5 Add `assets/` (the GitHub social card and its source) to the `changes` job's skip list, and to CONTRIBUTING.md's description of it. Verify, by running the job's matching loop on sample file lists, that a change to only `assets/` files reports `heavy=false`, and one that also touches `README.md` and a file under `src/` reports `heavy=true`.

## 3. ANGLE bump

- [x] 3.1 Add `angle/scripts/bump.py [<tag>]`. It takes the given oxgl-angle release, or by default reads the latest one, and, when it differs from `bundle_version`, rewrites `angle/bundles.toml` (version, every URL and digest, the symbols archives included) from that release's `SHA256SUMS`, then prints the new tag. Verify:
  - On a scratch copy pinned to `angle-8078.6`, it produces `angle-8078.7`'s URLs and digests, `check_pin.py` passes, and `git diff` shows only `bundles.toml`.
  - With the pin already at the latest release, it prints nothing and changes nothing.
  - `bump.py angle-8078.6` on a copy pinned to `angle-8078.5` pins `angle-8078.6`, even though it isn't the latest release.
  - With the release metadata stubbed, it refuses a release whose author isn't `github-actions[bot]`, one with any asset uploaded by another account, and one whose tag commit isn't on oxgl-angle's `main`, naming the reason. The real releases `angle-8078.5` to `angle-8078.7` pass.
- [ ] 3.2 Add `.github/workflows/angle-bump.yml`, modelled on oxgl-angle's. It runs daily at 10:17 UTC (three hours after oxgl-angle's 07:17 bump, design D4) and on `workflow_dispatch`, does nothing while npm has no published `@oxgl-js/oxgl` (design D4), runs `bump.py`, and bumps the patch version with `npm version patch --no-git-tag-version` only when npm already has the current version. It commits with the subject `Pin oxgl-angle <tag>`, force-pushes `angle-bump`, opens or edits the pull request, and runs `gh workflow run ci.yml --ref angle-bump`. It also handles closing stale bumps, leaving a branch alone when it carries a fix, and the `skip-bump` label. Document the flow in `angle/README.md`. Verify with actionlint and zizmor, and verify that its first scheduled run after merge, before the bootstrap, exits without pushing or opening anything. End-to-end verification is task 5.2.

## 4. Documentation

- [ ] 4.1 README:
  - Add an install section (`npm install @oxgl-js/oxgl`) and the requirements: glibc ≥ 2.34 on Linux (the release spec's baseline, design D6), no musl, Node ≥ 22.22.2, and the five supported platforms.
  - Add badges for the `ci` workflow status, the npm version and the license.
  - Point to `CONTRIBUTING.md` for building from source.

  CONTRIBUTING.md:
  - How to release: bump the version in a pull request.
  - What the ANGLE bump does and when it waits for a person.
  - The one-time npm setup from the design's migration plan, and how to finish a partial release by rerunning the `release` job.

  Verify that the badges render on the pull request's README preview and that every command shown runs as written.

## 5. Rollout (needs the maintainer)

- [x] 5.0 Before merging, the maintainer turns on "Allow GitHub Actions to create and approve pull requests" for jerryryle/oxgl (design, Migration Plan step 1). Verify that `gh api repos/jerryryle/oxgl/actions/permissions/workflow` reports `can_approve_pull_request_reviews: true`.
- [ ] 5.1 After the change merges, follow the design's migration plan:
  1. The maintainer bootstrap-publishes `0.1.1` from the `main` run's artifacts.
  2. The maintainer adds the trusted publishers (`jerryryle/oxgl`, `ci.yml`, environment `npm`) and sets "Require 2FA and disallow tokens".
  3. Rerun the `release` job.

  Verify that `npm view @oxgl-js/oxgl@0.1.1 optionalDependencies` lists the five platform packages at `0.1.1`, that `v0.1.1` and its GitHub Release exist, and that a fresh `npm install @oxgl-js/oxgl` in an empty directory renders on macOS arm64.
- [ ] 5.2 Right after 5.1, start `angle-bump.yml` with `workflow_dispatch`. oxgl still pins the bundle version it merged with, because the bump does nothing before the bootstrap, and oxgl-angle has a newer release. oxgl pins `angle-8078.7`, which is also oxgl-angle's latest release as of 2026-11-01, so this waits for its next release; until then the dispatch exits with nothing to do. Verify:
  - The bump pull request changes only `bundles.toml` and the version (to `0.1.2`).
  - CI passes on it, and `merge-bump` merges it.
  - The `main` run publishes `0.1.2` of all six packages with provenance visible on npmjs.com, and creates `v0.1.2`.

## 6. Rename the main package to `@oxgl-js/oxgl` (design D7)

The tasks above that are marked done were done and verified under the old name, `oxgl`. Their text now uses the new name; 6.3 re-verifies them under it.

- [x] 6.1 Rename the published main package, and set `version` to `0.1.1` in `package.json` and `package-lock.json` (design D7):
  - `package.json`'s `name` (edit in place, keep `@fission-ai/openspec`) and `package-lock.json`.
  - `scripts/pack.mjs`, `scripts/smoke-packed.mjs` and `scripts/release.mjs`, `.github/workflows/ci.yml`, the npm queries in `.github/workflows/angle-bump.yml` and `angle/scripts/bump.sh`, `src/resolve-native.ts`'s message telling the user which package to reinstall, and every mention of the package in `README.md` (install line, npm badges and links, the usage examples' imports) and `CONTRIBUTING.md` (Releases, One-time setup, the conformance tests' note on `npm install`).
  - Tests, fixtures and harnesses that import the package by its own name (`git grep` for `'oxgl'`, then keep the matches that aren't the package).
  - Not the repository, the Rust crates, the platform packages, the `v<version>` tag, `napi.binaryName` (the addon file `oxgl.<platform>.node`) or the `VENDOR`/`RENDERER` string and its assertions in `test/context-state.test.mjs`. Check that `src/resolve-native.ts` and `src/load-native.ts` resolve nothing by the main package's name.
- [x] 6.2 Pick tarballs by exact name everywhere (design D7): `ci.yml`'s removal of the main tarball from every leg but `ubuntu-24.04-arm` and its glibc check, `pack.mjs`'s check that the main tarball has no native files, `smoke-packed.mjs`, `release.mjs`'s publish order and "all six tarballs" check, and `CONTRIBUTING.md`'s manual publish commands.
- [x] 6.3 Verify: lint, `npm test` and CONTRIBUTING's repository checks; `node scripts/pack.mjs` then `node scripts/smoke-packed.mjs` on macOS arm64 and on Linux arm64 (Docker, per `CLAUDE.md`); `node scripts/release.mjs <dir> --dry-run` against a directory of all six tarball names, faking the four that can't be built locally, which must report the five platform packages and then `@oxgl-js/oxgl`, each once; and `npm publish --dry-run` of the packed main tarball, which must report the name `@oxgl-js/oxgl`. Verify actionlint and zizmor pass on every workflow, and run the npm queries of `angle-bump.yml` and `angle/scripts/bump.sh` once by hand against the registry, where they must report `@oxgl-js/oxgl` as unpublished.

## Workflow follow-up

- On archiving, also update node-api's Purpose, which names "the `oxgl` npm package", to `@oxgl-js/oxgl`; a delta can't change a Purpose.

- Archive this change after 5.2 passes, and verify `npx openspec validate --specs --strict` afterwards.
- `linux-arm64-focus` also modifies `angle-distribution`, `continuous-integration` and `node-api`. This change only adds requirements to them, apart from `continuous-integration`'s "Triggers" and `node-api`'s "Package entry point", which `linux-arm64-focus` doesn't touch. So they can be archived in either order.
