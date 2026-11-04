#!/usr/bin/env bash
# The ANGLE bump that angle-bump.yml makes: pins an oxgl-angle release (the
# given tag, or the latest) with bump.py, then bumps the patch version, so the
# bump releases when it lands. Prints the tag, or nothing when main needs no
# bump.
#
#     angle/scripts/bump.sh [tag]
set -euo pipefail
cd "$(dirname "$0")/../.."
tag="$(python3 angle/scripts/bump.py "$@")"
[ -n "$tag" ] || exit 0
npm version patch --no-git-tag-version --ignore-scripts > /dev/null
echo "$tag"
