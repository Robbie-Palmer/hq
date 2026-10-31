ARG BASE_IMAGE=scratch
FROM ${BASE_IMAGE}
COPY --chown=65532:65532 config/distribution.yml /etc/distribution/config.yml
COPY --chown=65532:65532 .state/auth/htpasswd /run/secrets/registry-htpasswd
USER 65532:65532
