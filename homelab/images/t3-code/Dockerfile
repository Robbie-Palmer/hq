FROM ghcr.io/jdx/mise:2026.10.0@sha256:5253aad873240675097e6229786dff87d54a9ac9d52917e42903de37511f74b3 AS mise-bootstrap

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS mise-tools

COPY --from=mise-bootstrap /usr/local/bin/mise /usr/local/bin/mise

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=shared-tool-config config.toml /tmp/t3-code-mise/mise.toml
COPY --from=shared-tool-config mise.lock /tmp/t3-code-mise/mise.lock
COPY mise.toml mise.lock /tmp/t3-code-mise/image/

RUN export MISE_CACHE_DIR=/tmp/mise-cache \
      MISE_DATA_DIR=/tmp/mise-data \
      MISE_STATE_DIR=/tmp/mise-state \
      MISE_TRUSTED_CONFIG_PATHS=/tmp/t3-code-mise \
    && mise -C /tmp/t3-code-mise/image install --locked \
      github:jdx/mise doppler vale \
    && mkdir -p /opt/t3-code-tools \
    && install --mode=0755 \
      "$(mise -C /tmp/t3-code-mise/image which doppler)" \
      /opt/t3-code-tools/doppler \
    && install --mode=0755 \
      "$(mise -C /tmp/t3-code-mise/image which vale)" \
      /opt/t3-code-tools/vale \
    && install --mode=0755 \
      "$(mise -C /tmp/t3-code-mise/image where github:jdx/mise)/bin/mise" \
      /opt/t3-code-tools/mise

FROM docker:29.8.2-cli@sha256:b1805116a6a86cc591b5d5f60a910a0715cdcc9d18d866ad68b1457ead25c35c AS docker-cli

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

LABEL org.opencontainers.image.source="https://github.com/Robbie-Palmer/hq"
LABEL org.opencontainers.image.description="Pinned t3-code runtime for the remote development K3s cluster"

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins
COPY --from=mise-tools /opt/t3-code-tools/ /usr/local/bin/
COPY bindep.txt package.json package-lock.json /usr/local/lib/t3-code/
COPY --from=agent-auth-mcp package.json package-lock.json /usr/local/lib/agent-auth-mcp/

# T3's npm launcher downloads and verifies the native release archive. Run it
# during the build so the runtime image does not need a first-start download,
# then replace its vulnerable undici and zod copies with the fixed pins.
RUN groupadd --gid 2000 t3code \
    && useradd --uid 2000 --gid 2000 --create-home --shell /bin/bash t3code \
    && apt-get update \
    && sed 's/ ==/=/' /usr/local/lib/t3-code/bindep.txt \
      > /tmp/bindep-apt.txt \
    && xargs --arg-file=/tmp/bindep-apt.txt \
      apt-get install --yes --no-install-recommends \
    && npm ci --ignore-scripts --omit=dev --prefix /usr/local/lib/t3-code \
    && npm ci --ignore-scripts --omit=dev --prefix /usr/local/lib/agent-auth-mcp \
    && t3_version="$(node -p \
      "require('/usr/local/lib/t3-code/package.json').dependencies.t3")" \
    && T3CODE_HOME=/tmp/t3-home \
      /usr/local/lib/t3-code/node_modules/.bin/t3 --version >/dev/null \
    && mkdir -p /usr/local/lib/t3-code/runtime/versions \
    && cp --archive \
      "/tmp/t3-home/runtime/versions/${t3_version}" \
      /usr/local/lib/t3-code/runtime/versions/ \
    && rm --recursive --force \
      "/usr/local/lib/t3-code/runtime/versions/${t3_version}/node_modules/undici" \
      "/usr/local/lib/t3-code/runtime/versions/${t3_version}/node_modules/zod" \
    && cp --archive \
      /usr/local/lib/t3-code/node_modules/undici \
      /usr/local/lib/t3-code/node_modules/zod \
      "/usr/local/lib/t3-code/runtime/versions/${t3_version}/node_modules/" \
    && chmod --recursive a+rX \
      "/usr/local/lib/t3-code/runtime/versions/${t3_version}" \
    && ln --symbolic \
      "/usr/local/lib/t3-code/runtime/versions/${t3_version}/t3" \
      /usr/local/bin/t3 \
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
      /usr/local/bin/ \
    && npm cache clean --force \
    && rm -f \
      /tmp/bindep-apt.txt \
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

COPY --chmod=0555 bootstrap-settings.mjs /usr/local/lib/t3-code/
COPY --from=agent-auth-mcp --chmod=0555 src /usr/local/lib/agent-auth-mcp/src

WORKDIR /data/workspaces
USER 2000:2000
EXPOSE 3773

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD curl --fail --max-time 2 --silent http://127.0.0.1:3773/ >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["t3", "serve", "--host=0.0.0.0", "--port=3773", "--base-dir=/data/home/.t3", "/data/workspaces"]
