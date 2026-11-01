FROM scratch
ARG TARGETARCH
COPY --chown=65532:65532 payload.txt /payload.txt
LABEL org.opencontainers.image.title="OCI registry spike fixture" \
      org.opencontainers.image.architecture="${TARGETARCH}"
USER 65532:65532

