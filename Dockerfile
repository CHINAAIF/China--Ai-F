# TRUNKIA Sovereign Dockerfile v1.0
FROM node:20-alpine

# Install tini for proper signal handling (Zombie process prevention)
RUN apk add --no-cache tini wget

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application code
COPY . .

# Switch to non-root user for security
USER node

# Expose API port
EXPOSE 9090

# Healthcheck (Polls /ping every 30s)
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:9090/ping || exit 1

# Use tini as entrypoint
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "index.js"]
