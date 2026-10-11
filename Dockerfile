# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY index.html vite.config.ts tsconfig*.json ./
COPY shared ./shared
COPY src ./src
COPY server ./server
COPY public ./public
RUN pnpm build

FROM node:24-alpine AS runtime
ARG DASHCENTER_VERSION=1.0.2
ARG DASHCENTER_REVISION=unknown

LABEL org.opencontainers.image.source="https://github.com/diabloduvi-ops/Dashcenter" \
      org.opencontainers.image.url="https://github.com/diabloduvi-ops/Dashcenter" \
      org.opencontainers.image.documentation="https://github.com/diabloduvi-ops/Dashcenter#readme" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${DASHCENTER_VERSION}" \
      org.opencontainers.image.revision="${DASHCENTER_REVISION}"

RUN apk add --no-cache dumb-init \
  && addgroup -S -g 10001 dashcenter \
  && adduser -S -D -H -u 10001 -G dashcenter dashcenter

WORKDIR /app
ENV NODE_ENV=production \
    DASHCENTER_VERSION=${DASHCENTER_VERSION} \
    DASHCENTER_REVISION=${DASHCENTER_REVISION} \
    PORT=3000 \
    DATA_DIR=/data

RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY docs/ASSET_PROVENANCE.md docs/DEPENDENCY_LICENSES.md docs/SOURCE_PROVENANCE.md ./docs/
COPY third_party_licenses ./third_party_licenses
RUN pnpm install --prod --frozen-lockfile && pnpm store prune

COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
RUN mkdir -p /data/uploads && chown -R dashcenter:dashcenter /data /app

USER dashcenter
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=4s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist-server/server/index.js"]
