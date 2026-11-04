# Design

## Context

Measured on recent runs: oxgl's build, Rust checks and Node tests take 5–7 minutes per platform, the three.js examples 11–17, conformance 10–66 (the two Windows webgl2 jobs are the long ones), and an oxgl-angle bundle build about 50 minutes per platform. The full oxgl matrix is about 34 jobs; a free organization runs 20 at once, 5 of them on macOS.

GitHub facts the design rests on:
- A merge queue builds a temporary `gh-readonly-queue/main/...` branch per group, runs the `merge_group` event on its commit, and fast-forwards `main` to that same commit when the required check passes. Later groups are built on top of earlier ones and tested at the same time.
- Required checks apply both to a pull request (before it may enter the queue) and to its merge group; the same check name, `ci` or `angle-build`, serves both.
- Pull requests and pushes made with the built-in token start no `pull_request` run that can satisfy a required check, which is why the bumps dispatch CI today. An App installation token does start them.
- A run may restore caches from its own ref and from `main`, but saves only to its own ref. A merge group's ref is deleted after the group lands, so what it saves is never reused.
- An artifact of another run can be downloaded with that run's ID and a token with `actions: read`; artifacts last for the retention the upload sets.

## Goals / Non-Goals

**Goals:**
- Per landed change: one full oxgl suite. Per new ANGLE version, end to end: one bundle build and one full oxgl suite.
- What is published (npm packages, recipe bundles, the results page) is exactly what the tested run produced.
- The workflows choose jobs by event, not by which files changed (oxgl-angle's recipe classification aside).
- Usually no person in the loop for an ANGLE update that passes (see Risks for the exception).

**Non-Goals:**
- Shortening the critical path (sharding the Windows webgl2 job, larger runners).
- Handling a failed queue run automatically beyond what the queue does (removing the group).

## Decisions

### One workflow per repository, four event shapes

`ci.yml` and `angle-build.yml` each keep one workflow and one aggregate check, with the job set chosen by event alone:

```
event            oxgl ci.yml                          oxgl-angle angle-build.yml
---------------  -----------------------------------  ----------------------------------
pull_request     quick: lint, repo-checks, check,     lint, guard
                 build+smoke, node-test               (full-ci label: + build, smoke)
                 (full-ci label: + full)
merge_group      full: quick + asan, conformance,     lint, guard; build, smoke when the
                 threejs, results                     recipe or the workflow changed
push to main     release and pages from the group     release from the group run when
                 run; warm caches                     the recipe changed; dispatch oxgl
workflow_dispatch full; on main also release/pages    build, smoke; on main also release
```

On a push to `main`, oxgl's `angle-bump.yml` also runs, as a workflow of its own (see "Bot identity and the bump pull requests"); `ci.yml` has no bump job.

oxgl drops its skip list and page-only classification: which jobs run depends only on the event. A documentation pull request costs a full queue run (4 of the last 30 merged pull requests were documentation-only), in exchange for no file classification, no changed-files comparison in the queue, and no case where a queue run built nothing. oxgl-angle keeps its recipe classification, because it decides whether a landing releases and a bundle build takes 50 minutes per platform.

Keeping publishing in `ci.yml` keeps npm's trusted-publisher entries (which name the workflow file) and the `npm` environment unchanged. A separate `release.yml` was the alternative; it reads more cleanly but means editing six packages' trusted publishers and adds a `workflow_run` hop.

The `changes` job shrinks to two outputs: `full` (`merge_group`, `workflow_dispatch`, or a `full-ci` label) and, on `main`, `release` (the version isn't on npm). A push run also computes `before..sha` for the `caches` job only. Label events start no run: with the `labeled` type, every label added would cancel and restart the pull request's run. `full-ci` takes effect on the next push, and a manual run on the branch gives the full checks at once. The aggregate check skips only the full-only jobs when `full` is false.

### Publishing from the merge group run

The push run's release job looks up the completed `merge_group` run of the same workflow whose `head_sha` is `github.sha` and whose `ci` job passed, downloads its packages and reports with `run-id`, and runs `scripts/release.mjs` as today. Every merge group run builds packages; one whose version isn't on npm keeps them and the reports for 7 days, as the `main` run does today.

When `main`'s version is on npm, the push run does nothing for the release. When it isn't and no passing group run exists (a bypass merge), the release job fails with a message naming the manual run. A manual run on `main` builds, tests and releases in one run, so the release job's source is "this run" when the event is `workflow_dispatch` and "the group run for this commit" when it's `push`. Rebuilding on `main` after a bypass was the alternative; it adds a second full path to the push run for a rare case.

Releases run one at a time (the `npm-release` concurrency group), and `release.mjs` already skips published packages and an existing GitHub Release. So when a second change lands at the same version before the first one's release has published, the second release finds everything published and does nothing.

oxgl-angle's release job does the same with bundles: download the group run's bundles, write `SHA256SUMS`, create the release with the built-in token (so the bump's origin check still sees `github-actions[bot]` as author and uploader), then create an App token and send `repository_dispatch` (type `angle-release`) to oxgl.

### When oxgl releases

A release happens whenever `main`'s version isn't on npm, as today. Nothing checks that a change bumped the version: a forgotten bump leaves the change on `main` unreleased, where it shows as `main` ahead of the latest tag, and a one-line bump pull request releases it. An enforced bump was considered. It needs a list of which files require one, and in the queue a comparison with the entry's parent, to prevent nothing worse than that delay.

### Bundle-version guard against the base commit

oxgl-angle's guard keeps refusing an already-released `bundle_version`. When the change's own diff from the commit it's built on (the pull request's base; in a merge group the group head's parent `head^`, the entry ahead of it or `main`) touches the recipe, it also requires the version to be greater than at that commit, comparing the Chromium branch, then the build number. Without it, two recipe changes with the same version queued back to back would both pass, since the second is tested before the first releases, and the second would land under bundles built from the first's recipe. The cumulative range would make a documentation entry behind a recipe entry fail, so the guard uses the entry's own diff.

### Results page from the release

The release job builds the page from the reports it's publishing with, naming the version (`results-page.mjs` gains `--version`), and the `pages` job deploys it. Nothing else deploys the page: a change to the template or builder shows up with the next release, and a `full-ci` pull request run builds a preview artifact. This drops the search through `main` runs for unexpired reports, and the page can't drift from the release.

### Bot identity and the bump pull requests

An `oxgl-js` GitHub App with contents and pull requests write (and the implied metadata read), installed on both repositories, with its client ID and private key as the organization secrets `OXGL_BOT_CLIENT_ID` and `OXGL_BOT_PRIVATE_KEY` limited to those repositories. `actions/create-github-app-token` creates the token in the step before it's used. Its one-hour lifetime never matters, since every step that uses it takes seconds.

Both bump workflows push `angle-bump` and open the pull request with that token, then run `gh pr merge --auto --squash`. The queue then does what `merge-bump` did. The tree comparison that guarded `merge-bump` goes away: only writers can push to `angle-bump`, and a writer's fix is meant to land. The bump still never force-pushes over a branch that carries someone else's commit. oxgl's bump workflow drops its schedule and listens for `repository_dispatch` and `workflow_dispatch`. It also runs on every push to `main`, but rebuilds an unmodified bump only when its version is no longer greater than `main`'s or it no longer merges cleanly. Rebuilding whenever `main` moves, as today, would push to a queued pull request and pull it out of the queue on every landing. Never rebuilding would let a bump land at a version `main` already released, so the new pin would go unreleased.

### Warming caches from main

The push run gets a `caches` job on each platform, which runs only when the push changed a file a cache key is computed from (`angle/bundles.toml`, `conformance/suite.json`, `threejs/pin.json`, `Cargo.lock`, `package-lock.json`, `rust-toolchain.toml`, and `.github/workflows/ci.yml`, which sets `ASAN_NIGHTLY` in the AddressSanitizer key), and on a manual run on `main`, which covers a cold start after eviction. For each key the full checks use, it checks with `actions/cache/restore` and `lookup-only: true`, and only on a miss fetches the input and saves it. The bundle cache is filled by running `cargo check -p oxgl-sys`, with `OXGL_ANGLE_SYMBOLS=1` on the two Linux platforms, since the AddressSanitizer job shares that key and needs the symbols archive too, so `build.rs` stays the only code that writes that cache's layout and checks its digests. When `Cargo.lock`, `rust-toolchain.toml` or `ci.yml` changed, the push also runs the `build`, `check` and `asan` jobs themselves, after `caches`, so each saves its Rust build cache (`cargo-build-*`, `cargo-check-*`, `cargo-asan-*`) exactly as it restores it. Copying their compile steps into the `caches` job was the alternative; it would duplicate them for a run that happens only on dependency or toolchain changes, where the extra tests cost a few minutes. Without them, every queue run would compile from scratch, AddressSanitizer's nightly standard-library build included. The suite and three.js caches are filled by the same `ensureSuite` and `ensureRelease` the runners call. Accepting cold caches was the alternative: every queue job would download its inputs each time (the three.js release is the largest). That's a constant-factor cost, but it's paid by every job of every run.

### Queue settings

Squash merge with GitHub's default grouping, and a 2-hour status-check timeout (the full run is about 70 minutes, and runners queue). The queue gives each entry its own run, built on the entries ahead of it, so grouping several pull requests saves no runs; it only lets passing entries land together. Recorded in CONTRIBUTING with the rulesets, not specified.

No unsafe code, handles or JS buffers are involved; nothing here touches the safety rules.

## Risks / Trade-offs

- [A bypass merge that is due to release fails on `main` until someone starts the manual run] → Accepted. The failure names the fix.
- [An entry's run fails, so every entry built on it reruns] → The queue does this by itself. Two code changes queued back to back cost two full runs either way.
- [The design assumes how the queue builds entries: each entry gets its own run, its commit is what lands, and in oxgl-angle `head^` is the entry ahead] → Task 6.3 checks these on the first real queue runs, before anything else depends on them.
- [An ANGLE bump queued behind a developer's change at the same version lands unreleased: the developer's release publishes that version with the old pin, and the bump's release finds it published] → Accepted, like a forgotten bump. The stale-bump rebuild covers the case where the developer's change lands first; when both are queued, `main` shows ahead of the latest tag and a bump pull request releases the new pin.
- [A forgotten version bump leaves a change unreleased] → Accepted. It's visible as `main` ahead of the latest tag, and a bump pull request releases it.
- [A documentation pull request costs a full queue run] → Accepted for the simpler workflow, at about 4 in 30 merged pull requests.
- [The App's private key is a long-lived credential] → It's limited to the two repositories and to contents and pull requests: pushing `angle-bump`, opening and auto-merging pull requests, and `repository_dispatch` need no more. It's never given to jobs triggered by forks, because only `push`, `merge_group`, `workflow_dispatch`, `repository_dispatch` and `schedule` jobs read it.
- [GitHub changes how queue caches or artifacts behave] → The first queue run is checked against the facts above (task 6.3), before anything depends on them.
- [A results page change isn't live until the next release] → Accepted. A `full-ci` pull request run gives a preview.

## Migration Plan

`tasks.md` holds the order: the App and its secrets first, then oxgl-angle (its queue and release), then oxgl's workflow, then turning on both queues, then one end-to-end ANGLE update. Rollback: remove the merge-queue rule from both rulesets and revert the workflow commits. The old workflows release from `main` again.
