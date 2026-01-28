# =============================================================================
# Aura Agent - Railway-Ready Docker Image
# Expert AI agent for Aura.build automation
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build Stage
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json bun.lock* ./

# Install Node.js dependencies (using npm since bun may not be available)
RUN npm install --production=false

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

# Build TypeScript
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# -----------------------------------------------------------------------------
# Stage 2: Production Stage
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS production

# Labels
LABEL org.opencontainers.image.title="Aura Agent"
LABEL org.opencontainers.image.description="Expert AI agent for Aura.build automation"
LABEL org.opencontainers.image.version="1.0.0"
LABEL maintainer="alias"

WORKDIR /app

# Install runtime dependencies
# - Python 3 for Lux SDK and API interceptor
# - Chromium for browser automation
# - xvfb for headless display
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    chromium \
    chromium-driver \
    xvfb \
    fonts-liberation \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create Python virtual environment and install dependencies
RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"

# Install Python packages for Lux and API interception
RUN pip install --no-cache-dir \
    oagi \
    mitmproxy \
    httpx \
    pydantic \
    pillow \
    pyautogui

# Copy built application from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/scripts ./scripts

# Copy additional files
COPY .env.example ./
COPY README.md ./

# Set environment variables
ENV NODE_ENV=production
ENV DISPLAY=:99
ENV CHROME_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Expose ports
# 3000 - Main API/CLI server
# 8080 - API Interceptor proxy
EXPOSE 3000 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Create entrypoint script
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# Start Xvfb for headless browser\n\
Xvfb :99 -screen 0 1920x1080x24 &\n\
sleep 1\n\
\n\
# If running as server, start the API\n\
if [ "$MODE" = "server" ]; then\n\
    exec node dist/server.js\n\
elif [ "$MODE" = "intercept" ]; then\n\
    exec python3 scripts/api_interceptor.py --port ${PROXY_PORT:-8080}\n\
else\n\
    # Default: run CLI with passed arguments\n\
    exec node dist/cli.js "$@"\n\
fi' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Set entrypoint
ENTRYPOINT ["/app/entrypoint.sh"]

# Default command (can be overridden)
CMD ["--help"]
