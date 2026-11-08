# cuCIM TIFF GPU decode trial

## Decision

Do not route production TIFF or SVS reads through cuCIM 26.10 yet. Keep OpenSlide as the CPU
compatibility reader and viewer path. The candidate produced CUDA-resident RGB regions for every
fixture and materially improved batched JPEG and JPEG 2000 latency, but none of the seven public
fixtures preserved the complete OpenSlide pyramid, per-axis MPP, and associated-image contract.

Keep the follow-up to an upstream-focused cuCIM semantics check. Reconsider an optional training or
inference backend after cuCIM preserves Aperio MPP and pyramid semantics, exposes or records the
selected nvImageCodec decoder, and passes an anisotropic public fixture. Keep Leica on OpenSlide:
cuCIM selected a different image and pyramid from OpenSlide for `Leica-1.scn`.

This trial did not change the production tiler, its CPU installation, or its viewer/export behavior.
The prototype is an isolated benchmark image and a strict capability report. Its production eligibility
gate requires device output plus exact pyramid, MPP, and associated-image parity; every fixture failed
that gate and therefore falls back to the existing OpenSlide path.

## What ran

Three independent processes used the local benchmark image manifest
`sha256:8f4bce609d5670682589e2554ed2eb92262df9c4e5322d784466748d5133e854`
(2,861,241,235 bytes). It was not pushed. The local rootless Docker daemon did not have the NVIDIA
runtime and could not bind Nix store paths, so a diagnostic descendant copied the host driver libraries
and attached `/dev/nvidia0`, `/dev/nvidiactl`, and `/dev/nvidia-uvm`. That descendant had local manifest
`sha256:0c84b78da2417698edb23367a9863e04682ee360f67cc4204f6b52986b918806`
(3,289,188,909 bytes). This proves the bounded code path on the available GPU, not a K3s deployment.

| Property | Value |
| --- | --- |
| Base commit | `e5909fbe617e9463a8dfa67a6e3177137761699c` |
| Host | Linux 6.18.57, 13th Gen Intel Core i9-13950HX, 32 logical CPUs, 67,106,783,232 bytes RAM |
| GPU | NVIDIA GeForce RTX 4080 Laptop GPU, UUID `GPU-35a743e5-a848-d594-4ba1-b8b449ef0e4f`, capability 8.9, 12,453,019,648 bytes |
| Driver | 595.71.05 |
| Python / CuPy / CUDA runtime | 3.12.3 / 14.2.0 / 12.9.79 |
| CUDA NVRTC | 12.9.86 |
| cuCIM | 26.10.0, source `1b7642933c4b3eba9b3d8361889c6824875afacf` |
| nvImageCodec / nvJPEG / nvJPEG2000 | 0.9.0.20 / 12.4.0.76 / 0.12.0.58 |
| nvTIFF / nvCOMP | 0.9.0.86 / 5.3.0.16 |
| OpenSlide Python / library | 1.4.7 / 4.0.1 |
| tifffile | 2026.10.15 |
| Regions | 256 × 256 RGB at logical level 0; incomplete boundary regions excluded |
| Downstream work | Device center crop to 224 × 224, normalization, deterministic linear pooling proxy |
| Sampling | Contiguous and seeded random access; batches 1, 8, 32, and 128 where available |
| Repetitions | One warm-up and five measured repetitions per case, in three fresh processes |
| Timing | `perf_counter` wall time and process CPU time; CUDA events only for caller-stream stages |
| Cache and initialization | OS page cache warm; reader correctness probes completed; shared CuPy kernels primed |
| Storage path | Ordinary filesystem I/O; no GPUDirect Storage |
| Raw JSON SHA-256 | `6beec3489806804fc30e6713dd523b4ea7a7f11de81923206cee9585cf1d9fef` |
| Raw JSON SHA-256 | `6a531b2bed551842a84b2df938af77475cb241e0ade6075c4215cadfae81e562` |
| Raw JSON SHA-256 | `c78f9cdeb54ff125d6b972c7fd1c02ae5ad8aff51ec5ff915c82f2f7243733a8` |

cuCIM 26.10 pins nvImageCodec below 0.10, so this experiment uses a separate image from the
nvImageCodec 0.10 DICOM experiment. The installer uses cuCIM's wheel without transitive dependencies,
then installs the required CUDA codec wheels at exact versions. Allowing the wheel to resolve
`cupy[ctk]` pulled unused BLAS, FFT, and solver libraries and exhausted the rootless builder during the
trial. The explicit package set keeps the experiment reproducible without changing the production
package graph.

## Public fixtures

The Aperio and tiled TIFF files came from [WSILabs wsi-fixtures v8](https://github.com/WSILabs/wsi-fixtures/releases/tag/v8)
at source commit `3c52c9594a87d51a177836bbcce1350132392bbb`. The Leica file came from
[OpenSlide test data](https://openslide.cs.cmu.edu/download/openslide-testdata/Leica/). Acquisition
verifies byte counts and SHA-256 before the image is built.

| Fixture | Bytes | SHA-256 | Declared codec | License |
| --- | ---: | --- | --- | --- |
| `svs/CMU-1-Small-Region.svs` | 1,938,955 | `ed92d5a9f2e86df67640d6f92ce3e231419ce127131697fbbce42ad5e002c8a7` | JPEG | CC0-1.0 |
| `svs/239551.svs` | 26,637,925 | `019946dbe04eefaee18a90bb3222ae5ac51f081736ff1e195d0a52169ccc9535` | JPEG | CC-BY-4.0 |
| `svs/590_crop_jp2k_imagescope.svs` | 1,460,813 | `72cb781a8dae8ef6b3a446cedf9956f54690a3eb570a972fbb05e6dab48b8bfc` | JPEG 2000 | CC-BY-4.0 |
| `svs/590_crop_jpeg70_imagescope.svs` | 2,715,221 | `cbf8019fa3ed25b6936f0e8dfb9e171eb90daea443e91a96e48d8fa5bad95cbd` | JPEG | CC-BY-4.0 |
| `svs/590_crop_lzw_imagescope.tif` | 9,226,382 | `367a2c811d26d4063c5107b4aff673332c9dbf7ee78c315146452ef2ffbcabb0` | LZW | CC-BY-4.0 |
| `svs/590_crop_none_imagescope.tif` | 23,752,356 | `ad4205ea74e3664c4b4e319403650655d0851fb793ec511572869b30545fdd7c` | none | CC-BY-4.0 |
| `leica/Leica-1.scn` | 291,812,870 | `63a3c00fef5215497a9725cf19092a93f7f5ff855ce8561af74b087631831a97` | JPEG | OpenSlide distributable test-data license |

The matrix covers tiled Aperio JPEG, Aperio JPEG 2000, tiled TIFF LZW and uncompressed images, and
Leica SCN JPEG. A separate domain-neutral tiled TIFF fixture was attempted, but its public asset was
unavailable during the bounded run. Philips TIFF, Hamamatsu, MIRAX, and other formats were not tested.

## Decoder and copy boundary

[cuCIM's public documentation](https://github.com/rapidsai/cucim) says that cuslide2 uses nvImageCodec
for GPU-accelerated TIFF decoding, asynchronous batches, and tile caching, and lists Aperio, Philips,
and generic tiled RGB TIFF with JPEG, JPEG 2000, LZW, Deflate, or no compression. The trial set
`ENABLE_CUSLIDE2=1`, requested `device="cuda"`, and received an object implementing the CUDA array
interface for all seven fixtures. The
[pinned cuCIM source](https://github.com/rapidsai/cucim/tree/1b7642933c4b3eba9b3d8361889c6824875afacf)
maps TIFF JPEG and JPEG 2000 compression to nvImageCodec and writes decoded batches into strided
device buffers.

That is evidence of a genuine GPU-directed decode path and CUDA-resident output for the measured JPEG
and JPEG 2000 cases. It is not evidence that every decode operation ran only on the GPU. NVIDIA's
[plugin inventory](https://docs.nvidia.com/cuda/nvimagecodec/samples/query_and_select_plugins.html)
lists CPU fallbacks alongside GPU decoders, and JPEG's nvJPEG decoder is hybrid CPU/GPU. cuCIM does
not expose the plugin selected for a read. The experiment therefore cannot attribute every fixture to
a specific plugin or exclude a CPU fallback inside nvImageCodec. LZW and uncompressed TIFF only
received residency and semantic probes; they were not timed or independently pixel-checked.

Host work remains:

- ordinary filesystem reads and TIFF metadata parsing;
- compressed tile staging through host memory before nvImageCodec;
- host worker activity inside the JPEG and JPEG 2000 paths.

The candidate removes the large decoded RGB host buffer and explicit H2D copy. It does not remove all
host copies or CPU work. At JPEG batch 128, its median process CPU time was 364.14 ms during 57.98 ms
wall time, consistent with concurrent host workers. Its decoded output was already a 25,165,824-byte
device batch.

## Semantic gate

`Pyramid`, `MPP`, and `associated` compare cuCIM with OpenSlide. `Device` means a CUDA array was
returned. Eligibility requires all four columns to pass.

| Fixture | Device | Pyramid | MPP x/y | Associated images | Eligible |
| --- | --- | --- | --- | --- | --- |
| `CMU-1-Small-Region.svs` JPEG | yes | yes | no | yes | no |
| `239551.svs` JPEG | yes | yes | no | yes | no |
| `590_crop_jp2k_imagescope.svs` JPEG 2000 | yes | no | no | no | no |
| `590_crop_jpeg70_imagescope.svs` JPEG | yes | no | no | no | no |
| `590_crop_lzw_imagescope.tif` LZW | yes | no | no | no | no |
| `590_crop_none_imagescope.tif` none | yes | no | no | no | no |
| `Leica-1.scn` JPEG | yes | no | yes | no | no |

The two larger Aperio JPEG fixtures preserved dimensions and downsamples, but cuCIM reported
1.0 × 1.0 µm/px instead of OpenSlide's 0.499 × 0.499 and 0.4967 × 0.4967. The ImageScope crop files
were single-level images in OpenSlide. cuCIM added two duplicate reduced levels, reported 1.0 × 1.0
µm/px instead of 0.4982 × 0.4982, and omitted the thumbnail associated image.

The Leica mismatch is larger. OpenSlide selected a 53,130 × 153,470 level-0 image with five levels
and one macro image. cuCIM selected a 36,832 × 38,432 level-0 image, exposed eight interleaved levels,
and reported no associated images. Its 0.5 × 0.5 MPP happened to match, but the logical image and
pyramid did not.

All public TIFF fixtures in this run were isotropic. The contract retains x and y MPP separately and
will reject a one-axis mismatch, but this run does not validate cuCIM on anisotropic TIFF metadata.
An anisotropic fixture is required before production use.

## Pixel agreement and viewer path

Only level-aligned fixtures entered the measurement gate. Eight seeded regions per run were decoded
independently by OpenSlide and cuCIM. JPEG and JPEG 2000 both had maximum absolute channel error 1
with tolerance 3. Mean absolute error was 0.006397 for JPEG and 0.000032 for JPEG 2000. This oracle
does not excuse the metadata failures.

The retained CPU viewer decoded one JPEG region in a median 1.52 ms and encoded its PNG in 8.68 ms.
For JPEG 2000, the corresponding medians were 0.78 ms and 8.83 ms. These are single-request,
warm-cache measurements, not HTTP concurrency results.

## Steady-state timing

The CPU pipeline used OpenSlide to decode RGBA, packed RGB into pinned host memory, copied it to the
GPU, and ran the common downstream stages. The cuCIM pipeline produced a contiguous CUDA-resident RGB
batch and ran the same downstream work without an explicit H2D copy. Each table entry is the median
of three run medians; parentheses contain the minimum and maximum run medians. Speedup is CPU wall
time divided by cuCIM wall time.

### Aperio JPEG, `239551.svs`

| Access | Batch | OpenSlide + pinned H2D | cuCIM device output | Speedup |
| --- | ---: | ---: | ---: | ---: |
| Contiguous | 1 | 1.183 ms (1.172–1.201) | 0.877 ms (0.866–0.879) | 1.35× |
| Contiguous | 8 | 9.040 ms (9.005–9.201) | 3.110 ms (2.833–3.318) | 2.91× |
| Contiguous | 32 | 34.060 ms (33.584–34.143) | 14.870 ms (9.493–27.069) | 2.29× |
| Contiguous | 128 | 182.377 ms (182.192–182.774) | 57.976 ms (55.864–58.530) | 3.15× |
| Random | 1 | 6.484 ms (6.429–6.509) | 2.558 ms (2.300–3.224) | 2.53× |
| Random | 8 | 7.408 ms (7.365–7.446) | 3.309 ms (3.287–3.476) | 2.24× |
| Random | 32 | 32.292 ms (32.132–33.483) | 19.545 ms (17.038–23.526) | 1.65× |
| Random | 128 | 197.262 ms (196.868–197.835) | 73.848 ms (72.514–74.079) | 2.67× |

At contiguous batch 128, OpenSlide spent 160.11 ms decoding RGBA, 12.70 ms packing 24 MiB of pinned
RGB, and 2.02 ms on H2D. cuCIM spent 47.11 ms returning the 24 MiB device batch. Common preprocessing
and consumer stages account for the remaining wall time. The CuPy pool reserved 1,130,365,440 bytes
for cuCIM and 1,155,531,264 bytes for the CPU pipeline. These figures exclude cuCIM's internal device
allocator.

### Aperio JPEG 2000, `590_crop_jp2k_imagescope.svs`

| Access | Batch | OpenSlide + pinned H2D | cuCIM device output | Speedup |
| --- | ---: | ---: | ---: | ---: |
| Contiguous | 1 | 1.147 ms (1.145–1.165) | 3.248 ms (3.247–3.249) | 0.35× |
| Contiguous | 8 | 8.102 ms (8.006–8.138) | 4.440 ms (4.431–5.634) | 1.83× |
| Contiguous | 32 | 32.572 ms (30.792–33.081) | 16.453 ms (14.915–17.212) | 1.98× |
| Random | 1 | 6.377 ms (1.977–6.419) | 2.954 ms (2.435–3.596) | 2.16× |
| Random | 8 | 7.512 ms (7.319–10.168) | 4.126 ms (4.047–5.775) | 1.82× |
| Random | 32 | 32.979 ms (30.668–33.491) | 15.692 ms (13.986–16.426) | 2.10× |

The crop contains 81 complete 256 × 256 regions, so batch 128 was omitted rather than padded or
wrapped. At contiguous batch 32, OpenSlide spent 26.25 ms decoding, 3.08 ms packing 6 MiB of RGB, and
0.53 ms on H2D. cuCIM returned the 6 MiB device batch in 13.34 ms. Single contiguous JPEG 2000 was
2.83 times slower through cuCIM, while batches of eight and 32 were faster.

## Limits

- The run measures warm-cache throughput after correctness probes. Cold-start and cold-storage
  performance remain unmeasured. The extra diagnostic sample is named
  `first_sample_after_correctness_probe`.
- CUDA events cover only work on the caller's stream. cuCIM uses internal streams, so its decode stage
  is reported with synchronized wall and process CPU time. A decode CUDA-event duration is unavailable.
- Peak RSS is the cumulative process high-water mark. CuPy pool accounting excludes cuCIM's internal
  allocations.
- The deterministic pooling proxy makes device residency measurable without a hosted model. It is a
  synthetic consumer. No private data, paid API, hosted inference, or hosted model was used.
- The matrix has one large Aperio JPEG, one small Aperio JPEG 2000, four small ImageScope variants, and
  one Leica file. It does not establish clinical or fleet-wide performance.
- The public set has no anisotropic TIFF, Philips TIFF, Deflate TIFF, or generic non-ImageScope TIFF.
- The gate compares dimensions, downsamples, per-axis MPP, and associated-image names. It does not yet
  prove bounds, orientation, alpha, ICC color handling, or associated-image pixels. Those remain
  additional blockers even if the recorded metadata mismatches are fixed.
- nvImageCodec has CPU fallback plugins, and cuCIM does not report the selected plugin. Device output
  and source inspection establish the GPU-directed path. They cannot establish zero CPU codec work.
- No GDS path was tested. Compressed bytes still enter through host filesystem I/O.
- The local driver-library descendant is a diagnostic workaround and must stay outside production
  packaging.

The measured speedups justify keeping this harness for upstream fixes and later model-pipeline tests.
They do not outweigh incorrect slide semantics, so the production recommendation is to retain
OpenSlide and make no CUDA routing change.
