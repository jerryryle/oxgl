# Proposal

## Why

The ANGLE build recipe and oxgl share one repository, but they change on different schedules and need different checks. A recipe pull request runs oxgl's whole `ci` workflow, though it cannot affect oxgl until a later pull request updates `angle/bundles.toml`. Branch protection can't require both checks: `angle-build` runs only for recipe paths and `ci` runs for everything, so requiring both leaves one pending forever on most pull requests. oxgl already consumes ANGLE only through published release URLs and SHA-256 digests, so the recipe can live in a repository of its own. Inside oxgl, a pull request that touches only documentation or specs still runs the full build, the test suites, ASan and both conformance suites, which take far longer than the change needs.

## What Changes

- Create a recipe repository, `jerryryle/oxgl-angle`, holding today's `angle/` recipe (`pin.toml`, `args/`, `build.sh`, `build.ps1`, `scripts/bundle.py`, `scripts/pin.sh`, the pin half of `scripts/check_pin.py`, `smoke/`, `licenses.toml`, `license-texts/`) and `angle-build.yml`, with their git history.
- The recipe repository's build workflow runs on every pull request, builds only when recipe files or the workflow changed (a workflow-only change, such as a Dependabot action bump, needs no new bundle version), and reports one aggregate `angle-build` check for branch protection. Its releases are its only releases.
- Copy the published `angle-8078.2` assets byte-for-byte into an `angle-8078.2` release of the recipe repository and point `angle/bundles.toml` at them. The digests don't change and nothing is rebuilt. The old releases on `jerryryle/oxgl` stay, so older oxgl commits still build.
- oxgl keeps only the consumer side in `angle/`: `bundles.toml` and a README covering the manifest, the bundle layout, `OXGL_ANGLE_DIR`, how to take a new bundle, and "Known upstream issues".
- Remove from oxgl: `angle-build.yml`, the recipe files, the zizmor exception for `angle-build`, `oxgl-sys/build.rs`'s `pin.toml` read and version-mismatch warning, and the `pin.toml` checks in `angle/scripts/check_pin.py`, which stays in place as the `bundles.toml` check.
- oxgl's `ci` workflow still runs on every pull request and push to `main`. The heavyweight jobs (`check`, `node-range`, `asan`, `conformance`, and `gpu` when enabled) are skipped when every changed file is on a short list of paths that can't affect them: Markdown, `openspec/`, `.claude/`, `LICENSE`, `.editorconfig`, and the workflow linters' own config. `workflow-lint` and `repo-checks` always run. The aggregate `ci` check accepts those skips, so it stays the single required check.
- **BREAKING** (contributors only): changing ANGLE becomes two pull requests in two repositories, a recipe change and release in `oxgl-angle`, then a `bundles.toml` update in oxgl.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `angle-distribution`: the source pin, the build workflow, release immutability and the reproducible recipe move to the recipe repository. oxgl's repository pins only the published bundles (version, URL, digest). No workflow in oxgl builds ANGLE.
- `continuous-integration`: "Triggers" changes so the jobs that build or test oxgl run only when a change can affect them. "Aggregate status check" changes so `ci` passes when those jobs were skipped for that reason, and still fails when one was skipped for any other reason.

## Impact

- New GitHub repository `jerryryle/oxgl-angle` with its own branch protection (`angle-build` required) and Dependabot config for actions.
- oxgl: `.github/workflows/angle-build.yml` and the recipe files under `angle/` removed; `angle/bundles.toml` URLs changed (same digests); `angle/README.md`, `CONTRIBUTING.md`, `.github/zizmor.yml`, `crates/oxgl-sys/build.rs` and `angle/scripts/check_pin.py` updated. `ci.yml` gains a `changes` job, `if:` conditions on the heavy jobs, and a new aggregate condition.
- The license allowlist is duplicated into the recipe repository for `bundle.py`. oxgl's `deny.toml` stays authoritative: `build.rs` already re-checks bundle licenses against it.
- The open change `linux-arm64-focus` modifies the "ANGLE revision is pinned in the repository" requirement. Its delta is updated so archiving it later does not undo this change.
- No runtime, API or package change: the addon loads the same libraries with the same digests.

## Out of scope

- Changing the bundle format, the ANGLE revision, the platforms built, or how `oxgl-sys` downloads and verifies bundles.
- Deleting or moving the existing ANGLE releases on `jerryryle/oxgl`.
- Automating the oxgl `bundles.toml` update from a recipe release (for example a bot pull request). This change leaves room for it: the recipe release already prints the digests.
- Publishing the recipe for use by projects other than oxgl.
- Finer-grained gating in oxgl, such as running conformance only for renderer changes or `asan` only for Rust changes. One skip list for all heavy jobs is the extension point. A per-job list can be added later if one job's cost justifies it.
