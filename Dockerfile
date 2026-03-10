# La Mafia Spy — Backend Docker Image
# Uses Microsoft's official Playwright image (Chromium pre-installed!)
FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --omit=dev

# Copy all backend source files
COPY . .

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

# Start the server
CMD ["node", "server.js"]
