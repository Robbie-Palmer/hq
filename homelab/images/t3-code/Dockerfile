FROM docker@sha256:eccaacfeed644c7de222ff047483568cb988dde95476fbaaf10ea2d04921bb66 AS docker-cli

FROM node@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203

ARG MISE_VERSION
ARG MISE_SHA256=063dda9149ab6be53da877c2d176afe0eac68e64cf8ca295bd0528720701c65d
ARG DOPPLER_VERSION=3.76.5
ARG DOPPLER_SHA256=1b2f412d984920d665daf233ab6c15b364df9339b5c5b5224d5e8ee4e0a70154
ARG VALE_VERSION=3.19.0
ARG VALE_SHA256=c8f9d6c8055442bc7e9c121b2498e6f0e3fb670f4665e6ee577f1897f7665cf6

LABEL org.opencontainers.image.source="https://github.com/Robbie-Palmer/hq"
LABEL org.opencontainers.image.description="Pinned t3-code runtime for the remote development K3s cluster"

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins
COPY package.json package-lock.json /usr/local/lib/t3-code/

RUN test -n "${MISE_VERSION}" \
    && groupadd --gid 2000 t3code \
    && useradd --uid 2000 --gid 2000 --create-home --shell /bin/bash t3code \
    && apt-get update \
    && apt-get install --yes --no-install-recommends \
      bubblewrap \
      build-essential \
      ca-certificates \
      chromium \
      curl \
      dnsutils \
      fonts-liberation \
      fonts-noto-color-emoji \
      gh \
      git \
      iproute2 \
      jq \
      less \
      lsof \
      netcat-openbsd \
      openssh-client \
      procps \
      python3 \
      ripgrep \
      tini \
      unzip \
    && npm ci --ignore-scripts --omit=dev --prefix /usr/local/lib/t3-code \
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
      /usr/local/lib/t3-code/node_modules/.bin/codex \
      /usr/local/lib/t3-code/node_modules/.bin/grok \
      /usr/local/lib/t3-code/node_modules/.bin/opencode \
      /usr/local/lib/t3-code/node_modules/.bin/pnpm \
      /usr/local/lib/t3-code/node_modules/.bin/t3 \
      /usr/local/bin/ \
    && node /usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild \
      --directory /usr/local/lib/t3-code/node_modules/node-pty \
    && npm cache clean --force \
    && curl --fail --location --proto '=https' --proto-redir '=https' --silent --show-error \
      "https://github.com/jdx/mise/releases/download/v${MISE_VERSION}/mise-v${MISE_VERSION}-linux-x64.tar.gz" \
      --output /tmp/mise.tar.gz \
    && echo "${MISE_SHA256}  /tmp/mise.tar.gz" | sha256sum --check \
    && tar --extract --gzip --file /tmp/mise.tar.gz --directory /usr/local/bin \
      --strip-components=2 mise/bin/mise \
    && curl --fail --location --proto '=https' --proto-redir '=https' --silent --show-error \
      "https://github.com/DopplerHQ/cli/releases/download/${DOPPLER_VERSION}/doppler_${DOPPLER_VERSION}_linux_amd64.tar.gz" \
      --output /tmp/doppler.tar.gz \
    && echo "${DOPPLER_SHA256}  /tmp/doppler.tar.gz" | sha256sum --check \
    && tar --extract --gzip --file /tmp/doppler.tar.gz --directory /usr/local/bin doppler \
    && curl --fail --location --proto '=https' --proto-redir '=https' --silent --show-error \
      "https://github.com/errata-ai/vale/releases/download/v${VALE_VERSION}/vale_${VALE_VERSION}_Linux_64-bit.tar.gz" \
      --output /tmp/vale.tar.gz \
    && echo "${VALE_SHA256}  /tmp/vale.tar.gz" | sha256sum --check \
    && tar --extract --gzip --file /tmp/vale.tar.gz --directory /usr/local/bin vale \
    && rm -f /tmp/mise.tar.gz /tmp/doppler.tar.gz /tmp/vale.tar.gz \
    && apt-get purge --yes --auto-remove build-essential python3 \
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
