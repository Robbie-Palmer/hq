FROM docker.io/nvidia/cuda:12.8.1-base-ubuntu24.04@sha256:e711c99333fdfe8ae1e677b4972be6c5021f0128a1d31f775c7e58d88921b6a9

LABEL org.opencontainers.image.source="https://github.com/Robbie-Palmer/hq"
LABEL org.opencontainers.image.description="Pathologize DICOM GPU decode benchmark for Vector"

COPY --chmod=0555 homelab/images/pathologize-gpu-benchmark/install.sh /tmp/install.sh
COPY packages/data-artifacts/pyproject.toml packages/data-artifacts/README.md /tmp/hq/packages/data-artifacts/
COPY packages/data-artifacts/src /tmp/hq/packages/data-artifacts/src
COPY packages/ml-evaluation/pyproject.toml packages/ml-evaluation/README.md /tmp/hq/packages/ml-evaluation/
COPY packages/ml-evaluation/src /tmp/hq/packages/ml-evaluation/src
COPY packages/pathologize-tiler/pyproject.toml packages/pathologize-tiler/README.md /tmp/hq/packages/pathologize-tiler/
COPY packages/pathologize-tiler/src /tmp/hq/packages/pathologize-tiler/src
COPY ml-pipelines/pathologize-benchmark-contracts/pyproject.toml ml-pipelines/pathologize-benchmark-contracts/README.md /tmp/hq/ml-pipelines/pathologize-benchmark-contracts/
COPY ml-pipelines/pathologize-benchmark-contracts/src /tmp/hq/ml-pipelines/pathologize-benchmark-contracts/src
COPY ml-pipelines/pathologize-tiling-benchmark/pyproject.toml /tmp/hq/ml-pipelines/pathologize-tiling-benchmark/
COPY ml-pipelines/pathologize-tiling-benchmark/src /tmp/hq/ml-pipelines/pathologize-tiling-benchmark/src
COPY ml-pipelines/pathologize-data-registry/data/raw/cptac-coad-idc/v23/b117aabf-c225-432e-95af-8ee9247a1ad6 /opt/pathologize/fixtures/cptac-coad-dicom

RUN /tmp/install.sh \
    && chmod --recursive a=rX /opt/pathologize \
    && rm --recursive --force /tmp/hq /tmp/install.sh /root/.cache

ENV HOME=/tmp
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_BREAK_SYSTEM_PACKAGES=1

USER 1000:1000
WORKDIR /tmp

ENTRYPOINT ["pathologize-gpu-decode-benchmark"]
CMD ["run", "--fixture-root=/opt/pathologize/fixtures/cptac-coad-dicom"]
