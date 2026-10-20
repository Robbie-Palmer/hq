# syntax=docker/dockerfile:1.19

FROM node:24.10.0-alpine3.22@sha256:775ba24d35a13e74dedce1d2af4ad510337b68d8e22be89e0ce2ccc299329083 AS build

WORKDIR /build

RUN --mount=type=cache,target=/root/.npm \
    npm install --global esbuild@0.25.11

COPY src/server.ts ./src/server.ts

RUN esbuild src/server.ts \
    --bundle \
    --format=esm \
    --platform=node \
    --target=node24 \
    --outfile=dist/server.mjs \
    && node --check dist/server.mjs

FROM node:24.10.0-alpine3.22@sha256:775ba24d35a13e74dedce1d2af4ad510337b68d8e22be89e0ce2ccc299329083

LABEL org.opencontainers.image.description="Portable Dockerfile boundary spike image"
LABEL org.opencontainers.image.source="https://github.com/Robbie-Palmer/hq"

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build --chown=node:node /build/dist/server.mjs /app/server.mjs

USER 1000:1000
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD ["wget", "--quiet", "--tries=1", "--spider", "http://127.0.0.1:8080/health"]

CMD ["node", "/app/server.mjs"]
