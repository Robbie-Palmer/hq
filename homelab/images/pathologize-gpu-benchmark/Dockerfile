FROM ghcr.io/astral-sh/uv:0.12.22@sha256:f513a91fc62fe7c17567eee97230dd198e43edb8a9fbecca843714a4358fe1bc AS uv

FROM docker.io/nvidia/cuda:13.0.0-base-ubuntu24.04@sha256:6e43a6b02e5f16e4a715953be8b29c40acbe84aed11a61357ef0fc899967fbd9

LABEL org.opencontainers.image.source="https://github.com/Robbie-Palmer/hq"
LABEL org.opencontainers.image.description="Pathologize DICOM GPU model-loader benchmark for Vector"

COPY --chmod=0555 homelab/images/pathologize-gpu-benchmark/install.sh /tmp/install.sh
COPY --from=uv /uv /usr/local/bin/uv
COPY packages/data-artifacts/pyproject.toml packages/data-artifacts/README.md /tmp/hq/packages/data-artifacts/
COPY packages/data-artifacts/src /tmp/hq/packages/data-artifacts/src
COPY packages/ml-evaluation/pyproject.toml packages/ml-evaluation/README.md /tmp/hq/packages/ml-evaluation/
COPY packages/ml-evaluation/src /tmp/hq/packages/ml-evaluation/src
COPY packages/pathologize-tiler/pyproject.toml packages/pathologize-tiler/README.md /tmp/hq/packages/pathologize-tiler/
COPY packages/pathologize-tiler/src /tmp/hq/packages/pathologize-tiler/src
COPY ml-pipelines/pathologize-benchmark-contracts/pyproject.toml ml-pipelines/pathologize-benchmark-contracts/README.md /tmp/hq/ml-pipelines/pathologize-benchmark-contracts/
COPY ml-pipelines/pathologize-benchmark-contracts/src /tmp/hq/ml-pipelines/pathologize-benchmark-contracts/src
COPY ml-pipelines/pathologize-tiling-benchmark/pyproject.toml ml-pipelines/pathologize-tiling-benchmark/uv.lock /tmp/hq/ml-pipelines/pathologize-tiling-benchmark/
COPY ml-pipelines/pathologize-tiling-benchmark/src /tmp/hq/ml-pipelines/pathologize-tiling-benchmark/src
COPY ml-pipelines/pathologize-data-registry/manifests/assets/cptac-coad-idc-v23-smallest-series.json /opt/pathologize/manifests/assets.json
COPY ml-pipelines/pathologize-data-registry/manifests/collections/cptac-coad-idc.json /opt/pathologize/manifests/collection.json
COPY ml-pipelines/pathologize-data-registry/data/raw/cptac-coad-idc/v23/b117aabf-c225-432e-95af-8ee9247a1ad6 /opt/pathologize/fixtures/cptac-coad-dicom

RUN /tmp/install.sh \
    && chmod --recursive a=rX /opt/pathologize \
    && rm --recursive --force /tmp/hq /tmp/install.sh /root/.cache

ENV HOME=/tmp
ENV PATH=/opt/pathologize/venv/bin:${PATH}
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_BREAK_SYSTEM_PACKAGES=1

USER 1000:1000
WORKDIR /tmp

ENTRYPOINT ["pathologize-model-loader-benchmark"]
CMD ["run", "--fixture-root=/opt/pathologize/fixtures/cptac-coad-dicom", "--fixture-manifest=/opt/pathologize/manifests/assets.json", "--fixture-collection-manifest=/opt/pathologize/manifests/collection.json"]
