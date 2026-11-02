# Tasks

## 1. Remove the GPU job

- [x] 1.1 Delete the `gpu` job and its comment from `.github/workflows/ci.yml`, and drop `gpu` from the `changes` job's comment listing the heavy jobs.
- [x] 1.2 Delete the `self-hosted-runner` section from `.github/actionlint.yaml`, deleting the file if nothing else is left in it. When the file goes, drop `.github/actionlint.yaml` from the `changes` job's skip list too.
- [x] 1.3 In `CONTRIBUTING.md`, delete the `gpu` row and make the `ci` row read "succeeds only when every job above succeeded".
- [x] 1.4 Check that no `gpu`, `oxgl-gpu` or `OXGL_GPU_RUNNER` reference to the job is left outside archived changes, and that workflow lint (actionlint and zizmor, as the `workflow-lint` job runs them) passes.
- [ ] 1.5 In the pull request's CI run, check that the run has no `gpu` job and that the `ci` check passes. *(Not done when archived on 2026-11-02: the branch had no pull request yet. The user chose to archive before its CI run.)*
