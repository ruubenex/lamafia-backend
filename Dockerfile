# La Mafia Spy — Backend Docker Image
# Uses node:20-slim + installs exact Chromium at BUILD TIME
# This eliminates ALL version mismatch issues permanently
FROM node:20-slim

WORKDIR /app

# Install system dependencies required by Chromium
RUN apt-get update && apt-get install -y \
    wget ca-certificates fonts-liberation \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 \
    libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 \
    libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 \
    libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 \
    libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release xdg-utils \
    --no-install-recommends && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
# We use 'npm install' instead of 'npm ci' to be more resilient to lockfile mismatches
# and we clean the cache to keep the image small and robust.
RUN npm install --omit=dev && npm cache clean --force

# Install Playwright's Chromium at BUILD TIME (baked into the image)
# This guarantees the correct Chromium revision for the installed npm version
RUN npx playwright install chromium

# Copy all backend source files
COPY . .

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:8000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

# Start the server
CMD ["node", "server.js"]
