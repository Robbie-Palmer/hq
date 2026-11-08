# Pathologize tiling benchmark

This project evaluates tissue-aware tile selection and declared physical scale.
Its manifest covers tile-selection F1, tissue coverage, selected background
fraction, and relative error in target and source microns per pixel. The
evaluator checks reported source scale against item metadata instead of merely
checking that an adapter echoed the requested target. The DVC graph writes
execution records, evaluation results, a comparison scorecard, a benchmark
index, and a DVC metrics file as separate outputs.

The physical-scale perturbation experiment runs the reusable
`pathologize-tiler` package against a pinned 18.7 MB CPTAC-COAD DICOM series
from NCI Imaging Data Commons. The registry record and DICOM Pixel Spacing
supply independent MPP truth. A preparation stage extracts real slide pixels
and halves the row count while preserving the field of view, which creates a
second source with known anisotropic pixels.

The experiment changes the MPP and pyramid metadata presented to the tiler,
then saves the produced PNG tile for every accepted case. Each result records
the perturbation, source and output dimensions, physical coverage, decoded
bytes, CPU time, source provenance, and failures. The evaluator stops if
physical coverage error does not increase with known metadata error. A control
that substitutes requested scale for source metadata must fail.

```bash
mise run //ml-pipelines/pathologize-tiling-benchmark:check
mise run //ml-pipelines/pathologize-tiling-benchmark:dvc -- dag
```

The package unit tests cover scale arithmetic and metadata rejection with fake
readers. DVC owns the public-data experiment, its derived anisotropic region,
actual tiles, metrics, verification report, and locks. One slide is enough to
test metric response, but it is not a representative clinical cohort and makes
no clinical-validity claim.

The optional CUDA harness compares the CPU/OpenJPEG and nvImageCodec JPEG 2000
paths on Vector without making CUDA a CPU installation requirement. It records
wall, process CPU, CUDA stage, copy-volume, memory, pixel-agreement, and CPU
viewer measurements for contiguous and random batches. See the
[Vector JPEG 2000 GPU decode experiment](reports/vector-jpeg2000-gpu-decode.md)
for the bounded result and its limitations.

The follow-up [model-loader experiment](reports/vector-jpeg2000-model-loader.md)
feeds both decode routes into a deterministic, locally initialized ResNet-18.
It measures cold and steady-state decode, queueing, preprocessing, forward,
backward, overlap, throughput, host CPU, GPU memory, and transfer bytes across
batch size and loader concurrency. It downloads no model weights.
