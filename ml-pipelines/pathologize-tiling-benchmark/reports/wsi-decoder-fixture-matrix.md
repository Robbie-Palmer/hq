# Public WSI decoder fixture matrix

## Result

The matrix now covers six checksum-pinned public fixtures and 734,485,824
downloaded bytes. It includes Aperio SVS, Leica SCN, generic tiled TIFF, DICOM
WSI, JPEG, and JPEG 2000. No slide binary is committed.

All six fixtures passed CPU metadata, per-axis level-selection, and boundary
read probes. The probe also requested host pixels after the optional CUDA
decoder probe failed because the CPU environment does not install
`nvidia.nvimgcodec`. This preserves the existing OpenSlide and wsidicom paths.

Only the two DICOM trials are possible with the repository as it stands:

- DICOM JPEG 2000 can rerun the existing encoded-frame and nvJPEG2000 trial.
  The exact CPTAC-COAD series already has an OpenJPEG oracle and a maximum
  allowed channel difference of 1.
- DICOM baseline JPEG can use the same encoded-frame seam with nvJPEG. The new
  Leica fixture makes this a real trial now, but sparse-coordinate sampling and
  a CPU pixel oracle still need to be added before performance numbers mean
  anything.

The TIFF-family trials remain blocked. The public fixtures and claimed GPU
codecs exist, but the repository does not package cuCIM or expose compressed
TIFF tiles to nvImageCodec. Leica SCN has a harder block because cuCIM does not
claim its container semantics. A codec claim alone is not enough to route a
slide.

## Matrix

The machine-readable matrix in
[`fixtures/wsi-decoder-matrix.json`](../fixtures/wsi-decoder-matrix.json)
records every source URL, object digest, byte count, license, level, dimension,
per-axis MPP, tile or frame shape, color model, associated image, backend
result, and GPU trial decision.

| Fixture | Container and codec | Pyramid | CPU result | GPU trial |
| --- | --- | --- | --- | --- |
| `aperio-cmu-1-small-jpeg` | Aperio SVS, tiled JPEG/RGB | 1 level, 2,220 x 2,967, 0.499 x 0.499 µm/px, 240 x 240 tiles | OpenSlide passed | Blocked on cuCIM packaging and semantic comparison |
| `aperio-cmu-1-jpeg2000` | Aperio SVS, JPEG 2000 ICT | 3 levels, 46,000 x 32,893 at level 0, 0.499 x 0.499 µm/px, 240 x 240 tiles | OpenSlide/OpenJPEG passed | Blocked on TIFF tile extraction or a cuCIM reader |
| `leica-1-scn-jpeg` | Leica SCN BigTIFF, JPEG/YCbCr | 5 projected levels, 53,130 x 153,470 at level 0, 0.5 x 0.5 µm/px, 512 x 512 source tiles | OpenSlide passed | Blocked because no accelerator claims Leica SCN semantics |
| `generic-cmu-1-tiff-jpeg` | Generic tiled TIFF, JPEG/YCbCr | 9 levels, 46,000 x 32,914 at level 0, 256 x 256 tiles | OpenSlide passed geometry and pixels; source MPP is implausible | Blocked on cuCIM packaging and physical-scale comparison |
| `dicom-leica-4-jpeg-sparse` | DICOM WSI, baseline JPEG, `TILED_SPARSE` | Logical levels 0, 2, 4; 23,374 x 22,079 at level 0; 1.05105387047 x 1.05105387047 µm/px; 256 x 256 frames | wsidicom/Pillow passed | Possible now through the DICOM frame seam and nvJPEG |
| `dicom-cptac-coad-jpeg2000` | DICOM WSI, JPEG 2000 lossy, `TILED_FULL` | Logical levels 0, 2, 3; 14,400 x 14,770 at level 0; 0.2501 x 0.2501 µm/px; 256 x 256 frames | wsidicom/OpenJPEG passed | Possible now through the measured nvJPEG2000 path |

The generic TIFF's `XResolution=10`, `YResolution=10`, and centimetre unit
normalize to 1000 x 1000 µm/px. That value is not credible for a whole-slide
scan. The fixture remains useful for TIFF and JPEG behavior, but a physical
tile request must reject its MPP rather than quietly choose a pyramid level.

The Leica SCN dimensions above are OpenSlide's slide canvas. The underlying
file contains one brightfield ROI whose TIFF directories use 512 x 512 tiles.
A container reader must reproduce the canvas bounds and ROI placement. JPEG
tile decoding covers only one part of that contract.

## Acquisition and licensing

The smoke task downloads only `CMU-1-Small-Region.svs`, 1,938,955 bytes. The
extended task acquires the full matrix into the ignored `data/` directory. It
streams each object to a partial file, checks its byte count and SHA-256, then
renames it. ZIP extraction rejects paths outside the fixture directory.

Five fixtures come from the [OpenSlide test-data
catalog](https://openslide.cs.cmu.edu/download/openslide-testdata/). Four use
CC0-1.0. The Leica SCN source page grants free use and distribution with or
without modification and credits Yves Sucaet. The DICOM JPEG 2000 series comes
from NCI Imaging Data Commons under CC BY 3.0. Its required attribution and six
object URLs are in the JSON matrix. The collection citation is Clunie,
Clifford, Pot, Wagner, Farahani, Kim, and Fedorov, "DICOM converted Slide
Microscopy images for the CPTAC-COAD collection," 2024,
[doi:10.5281/zenodo.13351625](https://doi.org/10.5281/zenodo.13351625).

The format expectations come from the primary documentation for [Aperio
SVS](https://openslide.org/formats/aperio/), [Leica
SCN](https://openslide.org/formats/leica/), [generic tiled
TIFF](https://openslide.org/formats/generic-tiff/), and [DICOM
WSI](https://openslide.org/formats/dicom/). The GPU candidates use NVIDIA's
[nvImageCodec documentation](https://docs.nvidia.com/cuda/nvimagecodec/) and
the published [cuCIM format
list](https://docs.rapids.ai/api/cucim/legacy/). Those documents list claimed
capabilities. A repository backend still needs fixture evidence that it
preserves slide semantics.

## CPU contract probes

The checked report is
[`reports/wsi-decoder-fixture-probes.json`](wsi-decoder-fixture-probes.json).
It records the exact host and dependency versions. This run used:

- 13th Gen Intel Core i9-13950HX, 32 logical CPUs, 67,106,783,232 bytes RAM;
- Linux 6.18.57 on x86_64;
- NVIDIA GeForce RTX 4080 Laptop GPU, driver 595.71.05, 12,282 MiB, compute
  capability 8.9, present but unused by the CPU probe;
- OpenSlide 4.0.1.2 with Python binding 1.4.7, wsidicom 0.36.1, Pillow 13.0.0,
  libjpeg-turbo 3.2.0, Pillow's OpenJPEG 2.5.4, pydicom 3.0.2, pylibjpeg 2.1.0,
  and pylibjpeg-openjpeg 2.6.0.

The optional CUDA lock contains nvImageCodec 0.10.0.9, nvJPEG 12.4.0.76, and
nvJPEG2000 0.12.0.58. The CPU probe did not install or load them.

The probe uses `time.perf_counter_ns`. It records one cold call and the median
of five warm calls. Each call opens the container, selects the nearest level
using both MPP axes, and decodes one boundary tile on the CPU. The OS page
cache is not controlled, so these timings check reproducibility and gross
regressions only. Backend throughput needs a controlled benchmark.

| Fixture | Selected level | Boundary shape | Cold | Warm median |
| --- | ---: | ---: | ---: | ---: |
| Aperio JPEG | 0 | 240 x 240 | 4.730 ms | 4.379 ms |
| Aperio JPEG 2000 | 2 | 240 x 240 | 3.423 ms | 3.386 ms |
| Leica SCN JPEG | 4 | 512 x 512 | 1.203 ms | 1.045 ms |
| Generic TIFF JPEG | 8 | 256 x 256 | 1.843 ms | 1.627 ms |
| DICOM sparse JPEG | logical 4, matrix index 2 | 180 x 99 | 915.358 ms | 622.295 ms |
| DICOM JPEG 2000 | logical 3, matrix index 2 | 8 x 54 | 16.682 ms | 17.055 ms |

The DICOM boundary shapes prove that a fixed-shape device batch needs padding
or shape buckets. Sampling includes the partial boundary tiles that the earlier
GPU run excluded.

The anisotropic contract uses a deterministic base scale of 0.5 x 0.75 µm/px,
downsamples 1, 2, and 4, and a requested scale of 1.0 x 1.5 µm/px. It must
select level 1. Unit tests also perturb one axis independently so an
implementation that collapses X and Y into one scalar fails.

## Limits

- The matrix has one fixture for each listed family and codec combination. It
  tests interoperability. It does not represent a clinical cohort.
- No acquired public WSI in this bounded set has native anisotropic spacing.
  The anisotropic check is deterministic metadata arithmetic. A native public
  anisotropic WSI remains a fixture gap.
- The probe reads one boundary tile at the coarsest selected level. It does not
  establish pixel agreement across all levels, orientations, ICC profiles, or
  associated images.
- OpenSlide returns host RGBA. wsidicom returns host RGB. The probe does not
  change the viewer or export path and does not route either through Pillow on
  device.
- cuCIM is not installed in the CPU environment. Aperio and generic TIFF GPU
  trials remain blocked until an optional package and a content-probed reader
  preserve dimensions, level choice, bounds, color, alpha, and per-axis MPP.
- The DICOM JPEG trial can run. A trusted RGB oracle and sparse-frame coordinate
  coverage remain prerequisites for a performance decision.
