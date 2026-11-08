FROM ghcr.io/robbie-palmer/pathologize-cucim-benchmark:0.1.0

USER root
COPY driver-libs/ /usr/local/nvidia/lib64/
ENV LD_LIBRARY_PATH=/usr/local/nvidia/lib64:/usr/local/lib/python3.12/dist-packages/nvidia/nvimgcodec
USER 1000:1000
