# Vector JPEG 2000 model-loader experiment

## Decision

Keep nvImageCodec as a batch-aware opt-in for DICOM JPEG 2000 model input. Do not make it the
viewer path or the unconditional training path.

With a deterministic, locally initialized ResNet-18, nvImageCodec increased median steady-state
throughput in every measured case. The gain was 1.60 to 6.52× for batches 32 and 64. One of the three
batch-64 training runs with one loader was slower than the CPU route, at 0.91×. Application-cold
results also reversed in several cases. Route selection still needs a batch threshold and a fallback.

The wall-time gain has a CPU cost. At batch 64, nvImageCodec consumed about 13 process CPU cores
during inference and 17 during training. The CPU/OpenJPEG route used about one core. This pod has a
20-core cgroup quota, so device decode can contend with other host work even when it improves GPU
throughput.

## Protocol

Three independent runs used random complete tiles from the public CPTAC-COAD DICOM series already
used by the [decode-only experiment](vector-jpeg2000-gpu-decode.md). Each case used one
application-cold batch, four discarded warm-up batches, and sixteen measured batches. The OS page
cache was warm. wsidicom's encoded and decoded frame caches were disabled.

The CPU route decoded with OpenJPEG into pinned PyTorch tensors, then issued a non-blocking H2D
copy. The candidate route read compressed DICOM frames, decoded them with nvImageCodec on the input
CUDA stream, and wrapped the result in PyTorch without a decoded host copy. Both routes center
cropped to 224 × 224, normalized with the same constants, and fed
`torchvision.models.resnet18(weights=None)`. The model used two output classes and local seed 1729.
Its state SHA-256 was
`353b6103e1f81b7c107bd2a6688ab470d66b3ac087dc7c6831e4f51bb8cebb11`. No weights were downloaded.

Inference ran in evaluation mode. Training ran forward, cross-entropy, and backward without an
optimizer step. Gradients accumulated within each measured window. A two-batch in-flight limit let
input work for batch N+1 overlap compute for batch N without retaining the whole window.

Wall and process CPU time used `perf_counter_ns` and `process_time_ns`. Worker CPU time used
`thread_time_ns`. CUDA stages used PyTorch events followed by a device synchronization. A 5 ms NVML
sampler recorded whole-process GPU memory, including allocations outside PyTorch. The overlap value
is `(summed stage work - end-to-end wall) / summed stage work`; queue wait is reported separately and
is not additive with end-to-end time. PyTorch recommends CUDA events or explicit synchronization for
GPU timing and pinned tensors for loader H2D transfer in its
[CUDA semantics](https://docs.pytorch.org/docs/stable/notes/cuda) and
[data loading](https://docs.pytorch.org/docs/stable/data.html) documentation. nvImageCodec documents
the explicit CUDA stream and CUDA array interfaces in its
[Python API](https://docs.nvidia.com/cuda/nvimagecodec/py_api.html).

## Environment and provenance

| Property | Value |
| --- | --- |
| GPU | NVIDIA GeForce RTX 4080 Laptop GPU, capability 8.9, PCI `00000000:01:00.0`, 12,453,019,648 bytes |
| Driver / CUDA | NVIDIA 595.71.05 / PyTorch CUDA 12.8 |
| CPU | 13th Gen Intel Core i9-13950HX, 32 visible logical CPUs, 20-core cgroup quota, cpuset `0-31` |
| Memory | 67,106,783,232 host bytes, 42,949,672,960-byte cgroup limit |
| Runtime | Linux 6.18.57, glibc 2.41, Python 3.12.15 |
| Model | PyTorch 2.9.1, torchvision 0.24.1, cuDNN 9.10.2.21 |
| Decode | wsidicom 0.36.1, pydicom 3.0.2, pylibjpeg-openjpeg 2.6.0 |
| Device decode | nvImageCodec 0.10.0.9, nvJPEG2000 0.12.0.58, CuPy 14.2.0 |
| Image toolkit | CUDA toolkit 12.8.1, CUDA runtime 12.8.90, CUDA NVRTC 12.8.93 |
| Local image manifest | `sha256:f1577f23f4776d463a658f46498c15f78148f61446477a8bb488dee7f50933e4` |
| Local image size | 12,635,047,059 bytes |
| Fixture | NCI IDC CPTAC-COAD DICOM converted slide microscopy series, CC-BY-3.0 |
| Fixture citation | Clunie et al. (2024), DOI `10.5281/zenodo.13351625` |
| Manifest SHA-256 | `6ca186a1034edee26536c42e5f14707674b7adf17096c3bd9c93dab850388c7b` |
| Fixture size | 18,701,962 bytes in six manifest-verified files |
| Level | Logical level 0, 14,400 × 14,770, 256 × 256 RGB tiles, 3,192 complete tiles |
| Physical scale | 0.2501 × 0.2501 µm/px |
| Transfer syntax | JPEG 2000 `1.2.840.10008.1.2.4.91`, `YBR_ICT` |
| Measurement source commit | `958c6f8f64866c03746332ce08df73dc0019320b` |
| Raw run SHA-256 | `831ec410c4c831478c0c7fcf2d9cf116dc2c31b9811dfe0f7354a8981de4a6bb` |
| Raw run SHA-256 | `ef8f2dcb863c7dd04f97af4137f4e1948fbc37c3f1840e4c2ac27f481fd6f29d` |
| Raw run SHA-256 | `80267a5a365e3ef6843d2f9150deceacd54dfb215b9de9beff19f0ffc86aaf64` |

The checked asset manifest records every source URL, byte count, and SHA-256. The series came from
the NCI Imaging Data Commons public bucket and is cited through the
[public Zenodo record](https://doi.org/10.5281/zenodo.13351625).

## End-to-end throughput

Values are samples per second. Each throughput value is the median of three run-level results. The
speedup range is the minimum and maximum device-to-CPU throughput ratio across those runs. Cold is
the first batch after fresh model, decoder, and worker setup inside a process with a warm OS cache
and initialized CUDA runtime. It is not a disk-cold or reboot-cold measurement.

| Workload | Batch | Loaders | Cold CPU | Cold device | Cold speedup | Steady CPU | Steady device | Steady speedup |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Inference | 8 | 1 | 36.1 | 161.0 | 4.46× [2.83 to 4.87] | 140.1 | 446.6 | 3.18× [1.62 to 3.27] |
| Inference | 8 | 2 | 92.0 | 123.1 | 1.34× [1.05 to 1.51] | 131.3 | 466.9 | 3.46× [1.09 to 3.58] |
| Inference | 8 | 4 | 35.1 | 50.9 | 1.51× [0.32 to 2.42] | 130.7 | 444.5 | 3.31× [3.25 to 3.67] |
| Inference | 32 | 1 | 395.3 | 516.6 | 1.31× [0.99 to 2.47] | 532.2 | 960.4 | 1.80× [1.46 to 3.97] |
| Inference | 32 | 2 | 209.2 | 263.0 | 2.07× [1.03 to 2.78] | 257.3 | 885.1 | 3.46× [3.15 to 4.50] |
| Inference | 32 | 4 | 85.1 | 213.9 | 2.51× [1.09 to 3.90] | 147.7 | 844.7 | 5.71× [4.63 to 6.34] |
| Inference | 64 | 1 | 299.5 | 513.9 | 1.82× [1.10 to 2.12] | 449.2 | 993.7 | 2.23× [2.12 to 2.57] |
| Inference | 64 | 2 | 458.2 | 624.6 | 1.34× [0.86 to 1.36] | 192.9 | 964.8 | 5.06× [2.13 to 5.23] |
| Inference | 64 | 4 | 157.9 | 244.2 | 1.55× [1.17 to 2.57] | 134.5 | 872.8 | 6.52× [6.37 to 6.53] |
| Training | 8 | 1 | 35.3 | 219.5 | 6.50× [2.99 to 7.08] | 105.8 | 265.7 | 2.47× [2.42 to 2.55] |
| Training | 8 | 2 | 62.0 | 105.8 | 1.90× [0.28 to 2.20] | 111.1 | 262.9 | 2.37× [1.72 to 2.55] |
| Training | 8 | 4 | 31.0 | 32.5 | 1.07× [0.28 to 1.29] | 112.3 | 261.3 | 2.33× [2.28 to 2.40] |
| Training | 32 | 1 | 138.1 | 296.5 | 2.19× [0.77 to 2.37] | 271.4 | 511.3 | 1.86× [1.55 to 2.04] |
| Training | 32 | 2 | 100.4 | 239.8 | 2.26× [2.25 to 2.72] | 144.0 | 492.6 | 3.42× [2.91 to 3.61] |
| Training | 32 | 4 | 74.8 | 105.2 | 1.38× [0.47 to 1.42] | 121.2 | 479.2 | 3.94× [1.32 to 3.97] |
| Training | 64 | 1 | 318.4 | 384.4 | 1.21× [1.03 to 2.65] | 294.5 | 469.6 | 1.60× [0.91 to 1.64] |
| Training | 64 | 2 | 180.9 | 298.7 | 1.65× [0.89 to 2.73] | 224.1 | 459.3 | 2.03× [1.25 to 2.19] |
| Training | 64 | 4 | 111.3 | 182.7 | 1.66× [1.64 to 3.29] | 121.3 | 459.5 | 3.69× [1.39 to 3.90] |

The CPU route did not scale with more readers. Its median throughput often fell at concurrency two
and four while its measured overlap rose. OpenJPEG work contended instead of creating free
throughput. The device route was much less sensitive to loader count because workers only fetched
compressed frames. These results support a small bounded loader pool, not a rule that more workers
are better.

## Stage, CPU, memory, and transfer results

The following stage medians use loader concurrency two. Decode is worker wall time for CPU/OpenJPEG
and CUDA event time for nvImageCodec. Pack/copy is pinned H2D for the CPU route and device batch pack
for the candidate. Queue wait overlaps other stages, so it must not be added to end-to-end time.

| Workload | Batch | Route | Decode | Pack/copy | Preprocess | Forward | Backward | E2E for 16 batches |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Inference | 8 | CPU | 60.30 ms | 4.41 ms | 18.00 ms | 17.78 ms | n/a | 975.03 ms |
| Inference | 8 | Device | 8.53 ms | 0.90 ms | 0.52 ms | 4.86 ms | n/a | 274.17 ms |
| Inference | 32 | CPU | 180.04 ms | 0.61 ms | 9.54 ms | 57.46 ms | n/a | 1,989.67 ms |
| Inference | 32 | Device | 23.92 ms | 1.63 ms | 0.60 ms | 10.75 ms | n/a | 578.44 ms |
| Inference | 64 | CPU | 816.43 ms | 1.24 ms | 11.68 ms | 82.96 ms | n/a | 5,309.79 ms |
| Inference | 64 | Device | 52.47 ms | 2.47 ms | 0.64 ms | 30.49 ms | n/a | 1,061.34 ms |
| Training | 8 | CPU | 64.99 ms | 4.58 ms | 16.09 ms | 14.76 ms | 13.45 ms | 1,152.35 ms |
| Training | 8 | Device | 9.89 ms | 0.98 ms | 0.57 ms | 6.58 ms | 14.01 ms | 486.97 ms |
| Training | 32 | CPU | 319.70 ms | 0.85 ms | 17.11 ms | 70.03 ms | 32.72 ms | 3,555.86 ms |
| Training | 32 | Device | 43.84 ms | 1.65 ms | 0.62 ms | 10.75 ms | 32.19 ms | 1,039.44 ms |
| Training | 64 | CPU | 313.68 ms | 1.14 ms | 11.18 ms | 32.26 ms | 64.80 ms | 4,568.78 ms |
| Training | 64 | Device | 113.88 ms | 2.36 ms | 0.62 ms | 31.37 ms | 63.72 ms | 2,229.46 ms |

For sixteen measured batches, decoded H2D traffic was 25.2, 100.7, and 201.3 MB at batches 8, 32,
and 64. Compressed device-route traffic was 0.36 to 0.44, 1.60 to 1.68, and 3.14 to 3.31 MB. The reduction
was about 57 to 64× for this random coordinate plan.

Whole-process GPU memory was similar between routes. The largest inference case reached 11.43 GB
for CPU decode and 11.53 GB for device decode, leaving less than 1 GB on this GPU. Batch-64 training
reached 5.92 and 6.01 GB. PyTorch's reserved-memory metric excludes nvImageCodec and CuPy, which is
why the report also samples whole-process memory through NVML.

The nvImageCodec batch-64 route used 12.7 to 13.4 mean CPU cores for inference and 17.2 to 17.6 for
training. The CPU route stayed near 1.1 cores. The device codec reduces uncompressed transfer and
wall time; it does not remove host work.

## Semantics, fallback, and limits

- The experiment calls `DicomSlide` at logical level 0 and records dimensions, tile size, and the
  ordered MPP tuple from the reader. It does not infer a level from array shape. Only complete tiles
  are batched, so partial-tile padding remains unresolved.
- The fixture is isotropic. Recording `(mpp_x, mpp_y)` preserves anisotropic metadata, but this run
  is not evidence for anisotropic resampling or generated pyramid levels.
- The CPU/OpenJPEG route and CPU viewer path are unchanged. The only tiler API change is an optional
  CUDA stream argument whose default remains `None`. nvImageCodec failure still leaves the existing
  CPU decoder available.
- The benchmark image is separate from serving images. It pins the public fixture and Python/CUDA
  dependencies and can use the registry-free Vector import path. Its build and CPU-side package and
  entrypoint checks passed. The measured runs used the local T3 GPU environment because Docker
  exposes no NVIDIA runtime here.
- nvImageCodec logged that its optional nvTIFF extension was absent. JPEG 2000 decoding remained
  registered and every candidate case completed. This experiment does not add nvTIFF because it
  does not exercise TIFF.
- CUDA was initialized and the OS page cache was warm before application-cold measurement. The
  cold table captures process order; it does not represent a machine start or cold storage.
- The pod shared the host and CPU concurrency had material run-to-run spread. Steady device decode
  won every median. One batch-64, single-loader training run lost at 0.91×. Production thresholds
  need a longer isolated job and more public fixtures before they become defaults.
- The model has deterministic local weights and no accuracy claim. The experiment measures pipeline
  cost only; it makes no claim about clinical usefulness.

Run the local path with:

```bash
mise run //ml-pipelines/pathologize-tiling-benchmark:model-loader:run -- \
  --output-path=/tmp/pathologize-model-loader.json
```

Build and import the pinned image without a registry with:

```bash
mise run //homelab:pathologize-gpu-image-build-check
mise run //homelab:pathologize-gpu-image-load-vector
mise run //homelab:vector-gpu-benchmark -- create pathologize-loader-001 \
  ghcr.io/robbie-palmer/pathologize-gpu-benchmark@sha256:<printed-local-digest>
```
