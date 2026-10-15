# SellerDoos production image: Next.js standalone server, data on the disk mounted at /data.
# Used by Render (render.yaml) or any Docker host (docker-compose.yml). See docs/deployment-plan.md.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Tools to compile better-sqlite3 if no prebuilt binary matches this platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 DISABLE_SCHEDULER=true DATABASE_PATH=/tmp/build.db SELLERDOOS_KEY_FILE=/tmp/build.key
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATABASE_PATH=/data/sellerdoos.db
RUN groupadd --system --gid 1001 sellerdoos && useradd --system --uid 1001 --gid sellerdoos --home /app sellerdoos \
  && mkdir -p /data && chown sellerdoos:sellerdoos /data
COPY --from=build --chown=sellerdoos /app/.next/standalone ./
COPY --from=build --chown=sellerdoos /app/.next/static ./.next/static
COPY --from=build --chown=sellerdoos /app/public ./public
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Starts as root only to hand the data disk to the app user (see docker-entrypoint.sh); the app never runs as root.
# The data disk is attached by the host (Render disk, or the sd-data volume in docker-compose.yml).
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
