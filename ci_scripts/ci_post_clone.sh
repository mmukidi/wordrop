#!/bin/sh
# Repo-root copy of the Xcode Cloud post-clone hook.
#
# Xcode Cloud looks for ci_scripts/ next to the Xcode project (ios/App/), but
# some workflow configurations resolve it from the repository root instead.
# Keeping a copy in both places means the hook fires either way. It simply
# delegates to the real script so there is only one implementation to maintain.
#
# If both locations fire, npm ci runs twice — wasteful but harmless.

set -e

REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-${CI_WORKSPACE:-$(cd "$(dirname "$0")/.." && pwd)}}"
exec "$REPO_ROOT/ios/App/ci_scripts/ci_post_clone.sh"
