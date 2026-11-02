#!/usr/bin/env bash
# The ANGLE bump that angle-bump.yml makes and merge-bump reruns on main:
# pins an oxgl-angle release (the given tag, or the latest) with bump.py, then
# bumps the patch version unless npm doesn't have the current version yet (so
# an unreleased version on main ships the new bundles). Prints the tag, or
# nothing when main needs no bump.
#
#     angle/scripts/bump.sh [tag]
set -euo pipefail
cd "$(dirname "$0")/../.."
tag="$(python3 angle/scripts/bump.py "$@")"
[ -n "$tag" ] || exit 0
current="$(node -p 'require("./package.json").version')"
if npm view "@oxgl-js/oxgl@$current" version > /dev/null 2>&1; then
  npm version patch --no-git-tag-version --ignore-scripts > /dev/null
fi
echo "$tag"
