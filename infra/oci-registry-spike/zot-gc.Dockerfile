ARG BASE_IMAGE=scratch
FROM ${BASE_IMAGE}
COPY config/zot-gc.json /etc/zot/config.json
COPY .state/auth/htpasswd /run/secrets/registry-htpasswd
