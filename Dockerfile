# ===============================
# Build stage
# ===============================
FROM node:20-alpine AS builder

WORKDIR /app

# Enable corepack (for pnpm)
RUN corepack enable

# Copy only dependency files
COPY package.json pnpm-lock.yaml ./

# Install dependencies (production only)
RUN pnpm install --frozen-lockfile --prod

# ===============================
# Production stage
# ===============================
FROM node:20-alpine AS production

# Labels (optional)
LABEL maintainer="your-email@example.com"
LABEL version="1.0.0"
LABEL description="Veo Video Generation API"

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeuser -u 1001 -G nodejs

WORKDIR /app

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY src ./src
COPY package.json ./

# Set ownership
RUN chown -R nodeuser:nodejs /app

# Switch to non-root user
USER nodeuser

# Cloud Run uses PORT automatically
EXPOSE 8080

# Health check (Cloud Run ignores it, but ok to keep)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 8080) + '/v1/health/live', r => process.exit(r.statusCode === 200 ? 0 : 1))"

# Environment
ENV NODE_ENV=production

# Start server
CMD ["node", "src/index.js"]
