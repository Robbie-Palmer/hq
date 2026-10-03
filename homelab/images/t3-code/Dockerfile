FROM ghcr.io/jdx/mise:2026.9.1@sha256:df5adf538c92d86f9807e738c7c7a9b32a1ae06edf441ede141333e3fe6a2cd9 AS mise-cli

FROM docker:29.8.0-cli@sha256:eccaacfeed644c7de222ff047483568cb988dde95476fbaaf10ea2d04921bb66 AS docker-cli

FROM node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203

LABEL org.opencontainers.image.source="https://github.com/Robbie-Palmer/hq"
LABEL org.opencontainers.image.description="Pinned t3-code runtime for the remote development K3s cluster"

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins
COPY --from=mise-cli /usr/local/bin/mise /usr/local/bin/mise
COPY --from=shared-tool-config config.toml /usr/local/lib/t3-code/mise/mise.toml
COPY --from=shared-tool-config mise.lock /usr/local/lib/t3-code/mise/mise.lock
COPY mise.toml mise.lock /usr/local/lib/t3-code/mise/image/
COPY bindep.txt package.json package-lock.json /usr/local/lib/t3-code/

# npm omits t3's optional platform bundle when reinstalling from its lockfile,
# so unpack the exact Linux package separately below.
RUN groupadd --gid 2000 t3code \
    && useradd --uid 2000 --gid 2000 --create-home --shell /bin/bash t3code \
    && apt-get update \
    && sed 's/ ==/=/' /usr/local/lib/t3-code/bindep.txt \
      > /tmp/bindep-apt.txt \
    && xargs --arg-file=/tmp/bindep-apt.txt \
      apt-get install --yes --no-install-recommends \
    && export MISE_CACHE_DIR=/tmp/mise-cache \
      MISE_DATA_DIR=/tmp/mise-data \
      MISE_STATE_DIR=/tmp/mise-state \
      MISE_TRUSTED_CONFIG_PATHS=/usr/local/lib/t3-code/mise \
    && mise -C /usr/local/lib/t3-code/mise/image install --locked doppler vale \
    && install --mode=0755 \
      "$(mise -C /usr/local/lib/t3-code/mise/image which doppler)" \
      /usr/local/bin/doppler \
    && install --mode=0755 \
      "$(mise -C /usr/local/lib/t3-code/mise/image which vale)" \
      /usr/local/bin/vale \
    && npm ci --ignore-scripts --omit=dev --prefix /usr/local/lib/t3-code \
    && t3_version="$(node -p \
      "require('/usr/local/lib/t3-code/package.json').dependencies.t3")" \
    && npm pack --ignore-scripts --pack-destination /tmp \
      "@t3code/t3-linux-x64@${t3_version}" \
    && mkdir -p /usr/local/lib/t3-code/node_modules/@t3code/t3-linux-x64 \
    && tar --extract --gzip \
      --file "/tmp/t3code-t3-linux-x64-${t3_version}.tgz" \
      --directory /usr/local/lib/t3-code/node_modules/@t3code/t3-linux-x64 \
      --strip-components=1 \
    && ln --force \
      /usr/local/lib/t3-code/node_modules/@anthropic-ai/claude-code-linux-x64/claude \
      /usr/local/lib/t3-code/node_modules/@anthropic-ai/claude-code/bin/claude.exe \
    && ln --force \
      /usr/local/lib/t3-code/node_modules/opencode-linux-x64/bin/opencode \
      /usr/local/lib/t3-code/node_modules/opencode-ai/bin/opencode.exe \
    && ln --force \
      /usr/local/lib/t3-code/node_modules/@pnpm/exe.linux-x64/pnpm \
      /usr/local/lib/t3-code/node_modules/pnpm/pnpm \
    && ln --symbolic \
      /usr/local/lib/t3-code/node_modules/.bin/claude \
      /usr/local/lib/t3-code/node_modules/.bin/auth-agent \
      /usr/local/lib/t3-code/node_modules/.bin/codex \
      /usr/local/lib/t3-code/node_modules/.bin/grok \
      /usr/local/lib/t3-code/node_modules/.bin/opencode \
      /usr/local/lib/t3-code/node_modules/.bin/pnpm \
      /usr/local/lib/t3-code/node_modules/.bin/t3 \
      /usr/local/bin/ \
    && npm cache clean --force \
    && rm -f \
      /tmp/bindep-apt.txt \
      "/tmp/t3code-t3-linux-x64-${t3_version}.tgz" \
    && rm -rf \
      /tmp/mise-cache \
      /tmp/mise-data \
      /tmp/mise-state \
      /usr/local/lib/t3-code/mise \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

ENV HOME=/data/home
ENV T3CODE_HOME=/data/home/.t3
ENV T3CODE_HOST=0.0.0.0
ENV T3CODE_PORT=3773
ENV T3CODE_NO_BROWSER=true
ENV MISE_EXPERIMENTAL=1
ENV MISE_TRUSTED_CONFIG_PATHS=/data/workspaces:/data/home/.t3/worktrees
ENV PATH=/data/home/.local/share/mise/shims:${PATH}
ENV PLAYWRIGHT_BROWSERS_PATH=/data/home/.cache/ms-playwright
ENV PUPPETEER_CACHE_DIR=/data/home/.cache/puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY --chmod=0555 bootstrap-settings.mjs /usr/local/lib/t3-code/bootstrap-settings.mjs

WORKDIR /data/workspaces
USER 2000:2000
EXPOSE 3773

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD curl --fail --max-time 2 --silent http://127.0.0.1:3773/ >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["t3", "serve", "--host=0.0.0.0", "--port=3773", "--base-dir=/data/home/.t3", "/data/workspaces"]
