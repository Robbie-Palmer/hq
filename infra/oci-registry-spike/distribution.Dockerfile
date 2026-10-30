ARG BASE_IMAGE=scratch
FROM ${BASE_IMAGE}
COPY config/distribution.yml /etc/distribution/config.yml
COPY .state/auth/htpasswd /run/secrets/registry-htpasswd
