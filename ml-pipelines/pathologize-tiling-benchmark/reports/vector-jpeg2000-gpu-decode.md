# Vector JPEG 2000 GPU decode experiment

## Decision

Continue with a bounded nvImageCodec path for batched DICOM JPEG 2000 training and inference. Do
not make it the universal tile path yet. Keep wsidicom/OpenJPEG as the required fallback and as the
viewer-serving path.

On this fixture, direct device decode improved steady-state end-to-end latency for every batch of
eight or more. It was slower for one contiguous tile and effectively tied for one random tile. The
result supports a batch-aware opt-in, not automatic routing based only on CUDA availability.

## Run

Three independent runs used the checked benchmark image based on local manifest digest
`sha256:8239f40ba6d394b954f59cb9d4bc8a8b60144418b13e1a2d27cd791f1d2f0393`. It was not pushed to
GHCR. The application, dependencies, and public fixture came from that image. Because this T3 pod
could not use Vector's root SSH path and the Docker daemon did not expose the NVIDIA runtime, the
diagnostic descendant added Vector's host driver libraries and attached `/dev/nvidia*` directly.
This proves the code path on Vector's GPU, but it is not evidence that the K3s image-import task or
benchmark Job ran successfully.

| Property | Value |
| --- | --- |
| GPU | NVIDIA GeForce RTX 4080 Laptop GPU, capability 8.9 |
| Host driver | 595.71.05 |
| CuPy / CUDA runtime | 14.2.0 / 12.9 |
| Codec | nvImageCodec 0.10 with nvJPEG2000 0.12 |
| Fixture | Public CPTAC-COAD DICOM WSI, JPEG 2000 transfer syntax `1.2.840.10008.1.2.4.91` |
| Tile / level | 256 × 256 RGB, logical level 0, 0.2501 × 0.2501 µm/px |
| Sampling | 3,192 complete tiles; partial boundary tiles excluded |
| Cache policy | OS page cache warm; wsidicom encoded and decoded frame caches disabled |
| Repetitions | One warm-up and five measured repetitions per case |
| Raw JSON SHA-256 | `136e6745aee3437eef3135302dfd00678e083aac8faf42aa824b934e34ba935a` |
| Raw JSON SHA-256 | `f09c2cc6c351c964dc0fe87dde34c3444a9672436fbbc4a456eddd39bf345938` |
| Raw JSON SHA-256 | `563771c0d227f008b1b1117fd9ff141d78d789f34b7a264d39fa6b4323df5e95` |

Both pipelines performed the same device center crop, normalization, and deterministic linear
pooling proxy after decode. The CPU pipeline decoded with OpenJPEG, packed into pinned host memory,
and copied to the device. The candidate passed compressed frame bytes to nvImageCodec, retained the
decoded images on the device, and packed them into one contiguous device batch.

## Steady-state result

Speedup is CPU pipeline wall time divided by nvImageCodec pipeline wall time. Each run reported the
median of five end-to-end measurements; the table reports the median of those three run medians.
The parenthesized values are the minimum and maximum run medians.

| Access | Batch | CPU decode + pinned H2D | nvImageCodec device decode | Speedup |
| --- | ---: | ---: | ---: | ---: |
| Contiguous | 1 | 2.23 ms (2.01–2.60) | 3.65 ms (3.62–3.70) | 0.61× |
| Contiguous | 8 | 14.10 ms (13.96–17.17) | 9.63 ms (9.06–10.00) | 1.46× |
| Contiguous | 32 | 54.92 ms (54.03–65.57) | 32.08 ms (31.15–35.88) | 1.71× |
| Contiguous | 128 | 186.29 ms (184.83–245.83) | 95.07 ms (94.47–108.76) | 1.96× |
| Random | 1 | 4.23 ms (2.03–6.21) | 3.65 ms (3.62–3.67) | 1.16× |
| Random | 8 | 11.51 ms (11.30–14.24) | 8.09 ms (7.85–8.21) | 1.42× |
| Random | 32 | 44.56 ms (44.13–54.96) | 26.21 ms (26.01–26.32) | 1.70× |
| Random | 128 | 168.14 ms (164.38–175.26) | 93.06 ms (73.44–95.04) | 1.81× |

At contiguous batch 128, the median stage results across runs were 176.17 ms for CPU decode,
5.44 ms for pinned packing, and 2.03 ms for the 24 MiB H2D copy. nvImageCodec looked up 0.56 MiB of
compressed frames in 9.71 ms, decoded 24 MiB of device pixels in 80.07 ms, and packed the device
batch in 4.07 ms. At random batch 128, the compressed input was 0.39 MiB and device decode took
72.16 ms.

The nvImageCodec path used less CuPy-pool memory at batch 128: 1,078,461,952 bytes versus
1,155,531,264 bytes. Process CPU time was much higher than wall time for the candidate (844 ms CPU
for 95 ms wall in the median contiguous case), which shows that nvImageCodec used several host worker
threads. This path lowers uncompressed host traffic and wall time; it does not eliminate host work.

Eight sampled tiles agreed with OpenJPEG to a maximum absolute channel error of 1 and mean absolute
error of 0.000167. Across runs, the retained CPU viewer path decoded one tile in a median 0.80 ms and
encoded PNG in 2.00 ms. These viewer numbers are not a concurrency or HTTP-serving benchmark.

## Limits and follow-up

- The fixture covers one DICOM JPEG 2000 WSI and one isotropic pyramid level. It says nothing about
  Aperio SVS, Leica formats, tiled TIFF JPEG, non-DICOM JPEG 2000 containers, anisotropic MPP,
  generated pyramid levels, or associated images.
- Complete tiles were selected because boundary frames have smaller decoded shapes. Production
  batching still needs an explicit padding or shape-bucketing contract for partial tiles.
- The report records the first measured call, but those values are process-order diagnostics: the
  correctness probe initializes both decoders and the first CPU case pays CuPy kernel compilation.
  Do not use them as cold-start comparisons.
- OS cache was warm. A storage-sensitive experiment should measure cold and warm runs separately.
- GPUDirect Storage is not in this path. wsidicom reads compressed codestreams into ordinary host
  bytes, and nvImageCodec's Python API consumes those bytes. Avoiding a sub-megabyte compressed host
  read is unlikely to justify a GDS integration before codec and end-to-end model tests.
- Run the existing decoder-fixture matrix next, then test cuCIM on tiled TIFF. Add a real model and
  concurrent data-loader trial before choosing a production batch threshold; include GPU
  utilization, throughput, CPU saturation, and overlap between decode and inference.

The registry-free Vector task should be used for the admitted rerun:

```bash
mise run //homelab:pathologize-gpu-image-build-check
mise run //homelab:pathologize-gpu-image-load-vector
mise run //homelab:vector-gpu-benchmark -- create pathologize-decode-001 \
  ghcr.io/robbie-palmer/pathologize-gpu-benchmark@sha256:<printed-local-digest>
```

The `ghcr.io` prefix is the image's repository-qualified OCI name. The local-import task streams the
image directly from Docker to Vector's containerd; it neither pushes to nor pulls from GHCR.
