#!/bin/bash
set -e

echo "📦 Installing npm dependencies..."
cd "$CI_WORKSPACE" || cd "$(pwd)"

# Ensure npm is available
which npm || (echo "npm not found, installing Node.js dependencies via Homebrew" && brew install node)

# Install dependencies
npm ci --legacy-peer-deps || npm install --legacy-peer-deps

echo "🔄 Syncing Capacitor..."
npx cap sync ios || true

echo "✅ Build preparation complete"
