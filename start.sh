#!/bin/bash
# La Mafia Spy — Backend Startup Script
# Run this from the backend directory

echo "👁️ Starting La Mafia Spy Backend..."
cd "$(dirname "$0")"

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '#' | xargs)
fi

# Install dependencies if needed
if [ ! -d node_modules ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

# Install Playwright browsers if needed
if [ ! -d "$(npx playwright install --dry-run chromium 2>&1 | grep 'Installing' | head -1 | awk '{print $3}')" ]; then
  echo "🌐 Installing Playwright Chromium..."
  npx playwright install chromium
fi

# Start the server
echo "🚀 Starting server on port ${PORT:-8000}..."
node server.js
