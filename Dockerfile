# ============================================
# Stage 1: Dependencies Installation Stage
# ============================================

# IMPORTANT: Node.js Version Maintenance
# Track the maintained Node.js 24 LTS line and Debian Bookworm security updates.
# Rebuild regularly so this moving tag picks up new patched releases.
ARG NODE_VERSION=24-bookworm-slim

FROM node:${NODE_VERSION} AS dependencies

RUN apt-get update && apt-get upgrade -y

# Set working directory
WORKDIR /app

# Copy package-related files first to leverage Docker's caching mechanism
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* pnpm-workspace.yaml* .npmrc* ./

# Install project dependencies with frozen lockfile for reproducible builds.
# No BuildKit cache mounts: Railway's builder only accepts them with a
# service-specific `id=s/<service-id>-...` prefix, so they are omitted to keep
# the Dockerfile portable. Dependency installs run from scratch on each build.
RUN if [ -f package-lock.json ]; then \
    npm ci --no-audit --no-fund; \
  elif [ -f yarn.lock ]; then \
    corepack enable yarn && yarn install --frozen-lockfile --production=false; \
  elif [ -f pnpm-lock.yaml ]; then \
    corepack enable pnpm && pnpm install --frozen-lockfile; \
  else \
    echo "No lockfile found." && exit 1; \
  fi

# ============================================
# Stage 2: Build Next.js application in standalone mode
# ============================================

FROM node:${NODE_VERSION} AS builder

RUN apt-get update && apt-get upgrade -y

# Set working directory
WORKDIR /app

# Copy project dependencies from dependencies stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy application source code
COPY . .

# The standalone server bundles Drizzle into Next.js chunks. Keep one resolved
# runtime copy so the one-off migration script can import its migrator directly.
RUN cp -RL node_modules/drizzle-orm /app/drizzle-runtime

# Bundle the public AWS RDS trust chain into the immutable image.
RUN node -e "fetch('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem').then((response) => { if (!response.ok) throw new Error('RDS CA download failed'); return response.text(); }).then((certificate) => require('node:fs').writeFileSync('/app/aws-rds-global-bundle.pem', certificate))"

ENV NODE_ENV=production
    # Next.js loads route modules while collecting build metadata. This placeholder
    # is scoped to the builder stage and is never copied into the runtime image.
    ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
ENV NEXT_TELEMETRY_DISABLED=1

# Build Next.js application
# If you want to speed up Docker rebuilds, you can cache the build artifacts
# by adding: --mount=type=cache,target=/app/.next/cache
# This caches the .next/cache directory across builds, but it also prevents
# .next/cache/fetch-cache from being included in the final image, meaning
# cached fetch responses from the build won't be available at runtime.
RUN if [ -f package-lock.json ]; then \
    npm run build; \
  elif [ -f yarn.lock ]; then \
    corepack enable yarn && yarn build; \
  elif [ -f pnpm-lock.yaml ]; then \
    corepack enable pnpm && pnpm build; \
  else \
    echo "No lockfile found." && exit 1; \
  fi

# ============================================
# Stage 3: Run Next.js application
# ============================================

FROM node:${NODE_VERSION} AS runner

RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends libreoffice-writer \
  && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the run time.
ENV NEXT_TELEMETRY_DISABLED=1

# Copy production assets. `public/` is tracked with a .gitkeep so this step
# succeeds on a clean checkout even when no static assets exist yet.
COPY --from=builder --chown=node:node /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown node:node .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/drizzle-runtime ./node_modules/drizzle-orm
COPY --from=builder --chown=node:node /app/aws-rds-global-bundle.pem ./aws-rds-global-bundle.pem
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/scripts/migrate.mjs ./scripts/migrate.mjs

# If you want to persist the fetch cache generated during the build so that
# cached responses are available immediately on startup, uncomment this line:
# COPY --from=builder --chown=node:node /app/.next/cache ./.next/cache

# Switch to non-root user for security best practices
USER node

# Expose port 3000 to allow HTTP traffic
EXPOSE 3000

# Apply pending database migrations, then start the Next.js standalone server.
# The migration script takes a PostgreSQL advisory lock, so several instances
# starting at once cannot race; if it fails the server does not start and the
# platform keeps the previous deployment serving traffic.
CMD ["sh", "-c", "node scripts/migrate.mjs && node server.js"]
