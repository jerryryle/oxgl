# Proposal

## Why

The slow work runs twice. A new ANGLE version is built once on the recipe repository's pull request and again on its `main` (the rebuilt bundles aren't bit-identical, so the released ones aren't the tested ones). oxgl then runs its full suite on the bump branch and again on `main`, and every oxgl code change runs the full suite on its pull request and again on `main`. Conformance is the slow stage (up to 66 minutes, for Windows webgl2) and ANGLE builds take about 50. Meanwhile the results page reflects the latest run on `main`, not the latest release. Now that both repositories belong to the `oxgl-js` organization, merge queues can run the slow work once, on the exact commit that lands.

## What Changes

- **Both repositories use a merge queue on `main`.** Pull requests run quick checks; the queue runs the full build and test once, on the commit that lands; a push to `main` publishes what that queue run built and runs nothing heavy.
  - oxgl pull requests run workflow lint, the repository checks, the Rust checks, the build and pack with its smoke test, and the Node tests, on all five platforms. AddressSanitizer, conformance, the three.js examples and the results page run in the queue, on a manual run, or on a pull request labelled `full-ci`. **BREAKING (behavior):** the skip list and the page-only path go away: every queue entry runs the full checks, documentation changes included.
  - oxgl-angle pull requests run workflow lint and the bundle-version guard, which now also requires, for a change to the recipe, a `bundle_version` greater than the one at the commit it's built on. oxgl-angle keeps its recipe classification, which decides when a landing releases. Bundles are built and smoke-tested in the queue (or with `full-ci`), and the push to `main` releases the queue run's bundles. **BREAKING (behavior):** recipe pull requests no longer build bundles unless labelled.
- **Releases publish the queue run's files.** The release job on `main` downloads the packages the queue run for that commit built and tested, and publishes them. A manual run on `main` builds, tests and releases in one run, which is how a version lands when a bypass merge skipped the queue. A push to `main` that is due to release but has no queue run fails and says so.
- **A release still means `main`'s version isn't on npm.** Bump `version` in a pull request to release it; nothing enforces the bump, so several changes can land before one release.
- **The results page belongs to the latest release.** It is deployed only by a release, from the reports of the run whose packages it published, and names that version. A change to the page goes live with the next release; a `full-ci` pull request run gives a preview.
- **The ANGLE chain is event-driven.** The recipe repository's daily Chrome-stable bump and oxgl's bump open pull requests as an organization GitHub App, so their CI runs normally, and turn on auto-merge. A recipe release starts oxgl's bump at once (replacing oxgl's daily schedule). Both `merge-bump` jobs and the manual CI dispatches go away. **BREAKING (behavior):** a fix a person pushes to a bump branch now merges through the queue once its checks pass, instead of waiting to be merged by hand; the bump workflow still never overwrites such a branch.
- The queue keeps the input caches (ANGLE bundles, the conformance suite, three.js, Cargo and npm downloads) warm from runs on `main`, since caches a queue run saves aren't visible to later runs.

Out of scope:
- Splitting the long Windows webgl2 conformance job to shorten the critical path. That's an independent change.
- Testing oxgl against a recipe pull request's unreleased bundles. `OXGL_ANGLE_DIR` covers local iteration, and recipe releases are cheap and immutable.
- Retries, fallbacks or alternate paths for runner or GitHub outages.
- Merge-queue settings (grouping, timeout) are repository settings, recorded in CONTRIBUTING but not specified.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `continuous-integration`: job sets chosen by event (pull requests, the merge queue, pushes to `main`, manual runs) in place of the skip list; the aggregate check; the results page's deploy; removing page-only rebuilds; cache warming; the bot identity.
- `release`: where a release's files come from (the queue run for the commit, or a manual run on `main`), and what a release after a bypass merge needs.
- `angle-distribution`: the recipe repository builds in its queue and releases the queue run's bundles; its Chrome-stable bump; oxgl's bump starts when a recipe release appears and lands through the queue; what a bump that needs a person does.
- `results-page`: the page names the release it shows.

## Impact

- **oxgl:** `.github/workflows/ci.yml` (merge_group trigger, job selection by event, release and pages from the queue run, cache warming), `.github/workflows/angle-bump.yml` (repository_dispatch trigger, App token, auto-merge), `scripts/results-page.mjs` (version), `CONTRIBUTING.md`.
- **oxgl-angle (no OpenSpec there; tasks live in this change):** `.github/workflows/angle-build.yml` (merge_group, release from the queue run, dispatch to oxgl), `.github/workflows/angle-bump.yml` (App token, auto-merge), README.
- **GitHub settings, both repositories:** rulesets gain a merge queue requiring `ci` (oxgl) or `angle-build` (oxgl-angle); an organization GitHub App is created and installed on both, with its ID and key as organization secrets.
- **npm:** none. Publishing stays in `ci.yml` in the `npm` environment, so the trusted publishers don't change.
