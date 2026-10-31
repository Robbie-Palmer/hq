ARG BASE_IMAGE=scratch
FROM ${BASE_IMAGE}
COPY --chown=0:65532 --chmod=0440 config/distribution.yml /etc/distribution/config.yml
COPY --chown=0:65532 --chmod=0440 .state/auth/htpasswd /etc/distribution/registry-htpasswd
USER 65532:65532
