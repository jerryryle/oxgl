# Proposal

## Why

Four CI jobs build oxgl from source on their own: `check` on each platform, `node-range`, `conformance` (ten legs) and `threejs`. Each run therefore compiles the addon up to 18 times. The tests then judge 18 builds, while the release publishes the tarballs from `check` alone. These builds come from the same commit but are not the same files: they are built with different cache states, and only `check`'s are smoke-tested and published. The release spec already promises that the published files are the tested files (release, "Published files are the tested files"), and today that holds only for the smoke test.

The three.js examples run only on Linux arm64, where their expectations were seeded. A three.js regression on macOS or Windows goes unnoticed, and the results page shows "not run" in four of its five three.js columns.

## What Changes

- **One build job per platform.** A new `build` job, on the five platforms, runs `npm ci` and `npm run build`, packs and smoke-tests the packages, checks glibc on Linux, and always uploads the tarballs as `packages-<runner>`. As today, only the Linux arm64 leg keeps the `@oxgl-js/oxgl` tarball, so a run has exactly one; it is now uploaded as its own artifact, `package-main`.
- **Tests use the build's packages.** The Node tests, conformance, the three.js examples and the optional GPU job no longer build. Each downloads the `@oxgl-js/oxgl` tarball and its platform's tarball and unpacks them into `dist/`, then runs as today. The `@oxgl-js/oxgl` JavaScript that every platform tests is the Linux arm64 build's, which the release publishes. These jobs no longer need Rust or the ANGLE cache.
- **`check` becomes lint and Rust tests.** On each platform, `check` keeps `lint:rust`, `lint:js` and `cargo test`, and no longer builds the addon or runs the Node tests. It does not wait for `build`.
- **`node-range` folds into a `node-test` job.** `node-test` runs `npm test` with the build's packages on each platform on Node 24, and on Linux arm64 on both ends of `engines` (22.22.2 and 26), the legs `node-range` ran.
- **The release takes the build job's tarballs.** The release needs `build` instead of `check` and is otherwise unchanged.
- **three.js examples on every platform.** The `threejs` job runs on all five platforms, installing ffmpeg on each as the conformance job does, and uploads `threejs-results-<runner>`. The three.js report names its platform as the conformance report and the expectations do (`macos-arm64`, `windows-x64`, …); today it records Node's `darwin-arm64` and `win32-x64`, which the results page rejects. The results page then reads one report per platform, as it does for conformance, and drops "These run on Linux arm64 only". Differences from Linux arm64 are fixed, or recorded as platform-limited expectations (`<example> <OUTCOME> [<platform> ...]`, which the expectations file already supports) with their cause, for the user to agree.
- **Pinned trees keep their bytes on Windows.** The shared fetch of the conformance suite and the three.js release turns off Git's line-ending conversion, which Git for Windows commonly enables, so Windows serves the same files as every other host.
- **macOS and Windows arm64 first, locally.** Before the pull request is opened, the suite runs on macOS arm64 on a developer machine and on Windows arm64 in a VM, and each is compared with Linux arm64. Linux x64 and Windows x64 are then judged in the pull request's CI.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `continuous-integration`: a new requirement that each platform is built once per run and every test job uses that build. Node checks, Conformance job, three.js examples job, Packed packages are smoke-tested, and the Triggers and Aggregate status check scenarios that name the jobs change to match. The three.js examples job runs on every supported platform.
- `conformance-testing`: Pinned conformance suite requires the fetched files' bytes to be the commit's on every host.
- `threejs-examples`: Pinned three.js release likewise, and a new requirement admitting platform-limited expectations entries, by the conformance runner's rules, which the three.js runner already shares. Results report names the platform as the expectations do.
- `release`: Published files are the tested files names the build job, and says every test job ran against the published `@oxgl-js/oxgl` tarball.

## Impact

- `.github/workflows/ci.yml`: new `build` and `node-test` jobs; `check`, `conformance`, `threejs`, `gpu`, `ci`, `release` and `results` change; `node-range` is removed. Cache keys change so that `build` and `check` no longer share one.
- A new `scripts/unpack-packages.mjs` that unpacks the main and the host's platform tarball into `dist/`.
- `threejs/run.mjs` (the report's platform name), `conformance/suite.mjs` (`ensureCheckout`), the suite and release cache keys, `scripts/results-page.mjs` (the three.js section's description), `threejs/expectations.txt` (platform-limited entries, if any), and any runner or oxgl fix the comparisons call for, each added to the tasks and reviewed before it is made.
- `CONTRIBUTING.md`'s job table and three.js notes, and the README's three.js paragraph.
- No change to oxgl's native code is planned.

## Out of Scope and Extension Points

- **The ASan job** keeps building its own, instrumented, binaries: sanitizers need their own build, and the published build cannot be instrumented.
- **`cargo test` and clippy** still compile oxgl's crates in `check`. They build the Rust test binaries and lint, not the addon that ships.
- **Caching the build across runs** beyond today's cargo cache, and skipping a platform's build when nothing it reads changed, are left for later.
- **A per-platform dependency between jobs.** A test job waits for every platform's build, not only its own, because Actions cannot make one matrix leg depend on one leg of another. A later change could split the matrix into per-platform jobs if the wait matters.
