ARG CONFORMANCE_BUILDER_IMAGE=scratch
FROM ${CONFORMANCE_BUILDER_IMAGE} AS build
ARG CONFORMANCE_COMMIT
RUN apk add --no-cache git
RUN git clone https://github.com/opencontainers/distribution-spec.git /src \
    && cd /src \
    && git checkout --detach "${CONFORMANCE_COMMIT}" \
    && test "$(git rev-parse HEAD)" = "${CONFORMANCE_COMMIT}"
RUN cd /src/conformance \
    && CGO_ENABLED=0 go build -trimpath \
      -ldflags "-s -w -X main.Version=${CONFORMANCE_COMMIT}" \
      -o /conformance . \
    && chmod 0755 /conformance \
    && mkdir /results

FROM scratch
COPY --from=build --chown=65532:65532 /conformance /conformance
COPY --from=build --chown=65532:65532 /results /results
USER 65532:65532
ENTRYPOINT ["/conformance"]

