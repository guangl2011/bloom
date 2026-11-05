# syntax=docker/dockerfile:1
# Bloom platform image — shared dependency layer, per-target runtimes.
# The Next.js web app and every backend service build from this one file so the
# pnpm install layer is shared across all containers.
# NOTE: adding a workspace package? Add its package.json to the deps stage below.

FROM node:22-bookworm-slim AS base
RUN npm install -g pnpm@12.16.1
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/interfaces/package.json packages/interfaces/
COPY packages/service-kit/package.json packages/service-kit/
COPY adapters/adapter-scan-engine/package.json adapters/adapter-scan-engine/
COPY services/workflow/package.json services/workflow/
COPY services/approval/package.json services/approval/
COPY services/agents/package.json services/agents/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @bloom/web build

FROM base AS web
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone /app
COPY --from=build /app/apps/web/.next/static /app/apps/web/.next/static
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

FROM deps AS service
ENV NODE_ENV=production
# Runtime needs the TS sources tsx executes: the service itself plus any
# workspace packages its imports symlink into (@bloom/*, adapters), and the
# repo-level versioned skill assets the agents service loads at boot.
COPY packages/ packages/
COPY adapters/ adapters/
COPY services/ services/
COPY skills/ skills/
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@bloom/svc-workflow", "start"]
