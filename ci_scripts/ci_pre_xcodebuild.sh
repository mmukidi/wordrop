#!/bin/bash
set -e

echo "📦 Installing npm dependencies..."
cd "$CI_WORKSPACE"
npm install

echo "🔄 Syncing Capacitor..."
npx cap sync ios

echo "✅ Build preparation complete"
