# Tasks

## 1. Platform package README

- [x] 1.1 Add `scripts/platform-README.md` with the template the proposal shows.
- [x] 1.2 In `scripts/pack.mjs`, read the template, fail naming any of `{{package}}` and `{{platform}}` it lacks, fill both in, fail naming any `{{…}}` left after that, and write the result as the staged platform package's `README.md`, before anything is packed. Derive the label (`Linux x64 (glibc)`, `Linux arm64 (glibc)`, `macOS arm64`, `Windows x64`, `Windows arm64`) from the target data the script already has. Leave the manifest's `files` unchanged.
- [x] 1.3 Run `npm run build` and `node scripts/pack.mjs <out-dir>` on macOS arm64, and check that the `@oxgl-js/darwin-arm64` tarball's `README.md` is the template with `@oxgl-js/darwin-arm64` and `macOS arm64` filled in. Then remove `{{platform}}` from the template, and separately add `{{version}}` to it, checking each time that the pack fails naming it and writes no tarball, and restore the template.
- [ ] 1.4 In the pull request's CI run, download the `packages-ubuntu-24.04-arm` artifact and check the `@oxgl-js/linux-arm64-gnu` tarball against the scenario "README in the tarball", and check that the other three platform artifacts' READMEs carry their platform's name and label.
- [x] 1.5 Keep `scripts/platform-README.md` off the `changes` job's skip list in `.github/workflows/ci.yml`, where `*.md` would otherwise match it, so a change to the template alone still builds and packs (continuous-integration, "Skip list holds only unread files"), and say so in `CONTRIBUTING.md`.
