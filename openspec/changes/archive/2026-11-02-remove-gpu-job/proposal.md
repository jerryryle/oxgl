# Proposal

## Why

CI has a `gpu` job that runs the Node tests on a self-hosted `oxgl-gpu` runner, enabled by the `OXGL_GPU_RUNNER` repository variable. The repository has no self-hosted runners and no Actions variables (checked with `gh api repos/jerryryle/oxgl/actions/runners` and `gh variable list`), so the job never runs. It is still workflow code to keep current (it was rewired for the build's packages in ci-build-graph-threejs), and the specs and `CONTRIBUTING.md` describe a job nobody uses.

## What Changes

- **The `gpu` job is removed from `.github/workflows/ci.yml`**, with its comment and its mention in the `changes` job's comment.
- **`.github/actionlint.yaml` drops the `oxgl-gpu` runner label**, which only that job used. The file's `self-hosted-runner` section goes with it, since it then has no labels; that leaves the file empty, so it is deleted and dropped from the `changes` job's skip list.
- **`CONTRIBUTING.md` drops the `gpu` row** from the CI jobs table, and the `ci` row no longer excepts it.
- **The specs no longer name a GPU job.** The `continuous-integration` requirements that mention it change as below.

GPU coverage can come back as its own change when a runner exists; `git log` keeps the job's last form.

### Out of scope

- oxgl's GPU backends and the tests that skip without a GPU (`OXGL_GPU_UNAVAILABLE`) are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `continuous-integration`: "Each platform is built once per run" no longer names GPU tests among the jobs that use the build's packages, and the Triggers scenario "Documentation-only change" no longer lists the optional GPU job among the skipped jobs. The scenario "Skip list holds only unread files" names Dependabot's and zizmor's configuration, both on the skip list, instead of the workflow linters', since actionlint's goes. Both requirements are as ci-build-graph-threejs leaves them, so this change is archived after that one.

## Impact

- `.github/workflows/ci.yml`, `CONTRIBUTING.md`, and `.github/actionlint.yaml`, which is deleted. No job that the `ci` check needs changes.
