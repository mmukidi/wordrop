#!/bin/sh
# Xcode Cloud post-clone hook.
#
# WHY THIS FILE EXISTS AND WHY IT MUST BE ci_post_clone (not ci_pre_xcodebuild):
# This project uses Capacitor 8 with Swift Package Manager. ios/App/CapApp-SPM/
# Package.swift declares four plugins as LOCAL packages by relative path:
#     ../../../node_modules/@capacitor/{haptics,local-notifications,share,status-bar}
# node_modules/ is gitignored, so a fresh Xcode Cloud clone does not have them,
# and `xcodebuild -resolvePackageDependencies` fails with
# "the package at '.../node_modules/@capacitor/x' cannot be accessed".
#
# Xcode Cloud runs its scripts in this order:
#     1. ci_post_clone.sh      <- runs BEFORE dependency resolution   ✅
#     2. (xcodebuild -resolvePackageDependencies)
#     3. ci_pre_xcodebuild.sh  <- runs AFTER resolution, too late     ❌
# So npm install has to happen here, in step 1.

set -e

echo "==> ci_post_clone: preparing Wordrop iOS build"

# Repo root. CI_PRIMARY_REPOSITORY_PATH is the documented variable; fall back to
# CI_WORKSPACE, then to a path relative to this script (ios/App/ci_scripts).
REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-${CI_WORKSPACE:-$(cd "$(dirname "$0")/../../.." && pwd)}}"
echo "==> repo root: $REPO_ROOT"
cd "$REPO_ROOT"

# Node is not guaranteed to be on the Xcode Cloud image.
if ! command -v node >/dev/null 2>&1; then
    echo "==> node not found, installing via Homebrew"
    brew install node
fi
echo "==> node $(node --version) / npm $(npm --version)"

# Reduce the chance of a silent stall (Xcode Cloud kills a script after
# 15 minutes with no stdout/stderr activity).
npm config set maxsockets 3

echo "==> installing npm dependencies"
npm ci

echo "==> verifying the local Swift packages CapApp-SPM points at"
MISSING=0
for PKG in haptics local-notifications share status-bar; do
    if [ -f "node_modules/@capacitor/$PKG/Package.swift" ]; then
        echo "    ok      @capacitor/$PKG"
    else
        echo "    MISSING @capacitor/$PKG"
        MISSING=1
    fi
done
if [ "$MISSING" -ne 0 ]; then
    echo "==> ERROR: required Capacitor plugin packages are absent after npm ci."
    echo "    Package resolution would fail. Failing early with a clear message."
    exit 1
fi

# Rebuild www/ and refresh the native project (this regenerates
# CapApp-SPM/Package.swift from the installed plugin list).
echo "==> npm run build"
npm run build

echo "==> npx cap sync ios"
npx cap sync ios

echo "==> ci_post_clone: done"
