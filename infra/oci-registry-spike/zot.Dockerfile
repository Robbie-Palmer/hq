ARG BASE_IMAGE=scratch
FROM ${BASE_IMAGE}
COPY --chown=65532:65532 config/zot.json /etc/zot/config.json
COPY --chown=65532:65532 .state/auth/htpasswd /run/secrets/registry-htpasswd
COPY --chown=65532:65532 runtime/zot/ /var/lib/zot/
USER 65532:65532

