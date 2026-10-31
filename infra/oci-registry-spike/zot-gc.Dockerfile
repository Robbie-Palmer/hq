ARG BASE_IMAGE=scratch
FROM ${BASE_IMAGE}
COPY --chown=0:65532 --chmod=0440 config/zot-gc.json /etc/zot/config.json
COPY --chown=0:65532 --chmod=0440 .state/auth/htpasswd /etc/zot/registry-htpasswd
COPY --chown=65532:65532 runtime/zot/ /var/lib/zot/
USER 65532:65532
