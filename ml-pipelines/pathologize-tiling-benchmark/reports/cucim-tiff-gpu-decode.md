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
`sha256:2d22de8ab80a705f678d641128c0b28d7904c3d0dca506ebc18722b94becae3b`
(2,861,247,431 bytes). It was not pushed. The local rootless Docker daemon did not have the NVIDIA
runtime and could not bind Nix store paths, so a diagnostic descendant copied the host driver libraries
and attached `/dev/nvidia0`, `/dev/nvidiactl`, and `/dev/nvidia-uvm`. That descendant had local manifest
`sha256:9876fa5ac43829d2e0bf91285b7910857c90168daf72ab1ab5d75b09e4cb5183`
(3,289,186,853 bytes). This proves the bounded code path on the available GPU, not a K3s deployment.

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
| Sampling | Contiguous and seeded random access; batches 1, 8, 32, and 128 where available; pipeline order alternated by access/batch pair and recorded as `execution_position` |
| Repetitions | One warm-up and five measured repetitions per case, in three fresh processes |
| Timing | `perf_counter` wall time and process CPU time; CUDA events only for caller-stream stages |
| Cache and initialization | OS page cache warm; reader correctness probes completed; shared CuPy kernels primed |
| Storage path | Ordinary filesystem I/O; no GPUDirect Storage |
| Raw JSON SHA-256 | `87533e3395d41e88abc049caa90d3581d12d52c507304df167738217ac9cd078` |
| Raw JSON SHA-256 | `835437c46b2fb6a897847d33aea91cf63afe1cef86b279f0711a62ba063ce380` |
| Raw JSON SHA-256 | `b053ab203e37c8335bd68721c7abe437484438f9eeadfda4e52e4201ce63e2ee` |

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
host copies or CPU work. At JPEG batch 128, its median process CPU time was 364.38 ms during 59.73 ms
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

The retained CPU viewer decoded one JPEG region in a median 1.47 ms and encoded its PNG in 8.62 ms.
For JPEG 2000, the corresponding medians were 0.85 ms and 10.42 ms. These are single-request,
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
| Contiguous | 1 | 1.169 ms (1.166–1.170) | 0.884 ms (0.871–0.884) | 1.32× |
| Contiguous | 8 | 8.922 ms (8.867–13.946) | 3.042 ms (3.023–3.104) | 2.93× |
| Contiguous | 32 | 32.999 ms (29.418–33.724) | 14.972 ms (14.940–20.697) | 2.20× |
| Contiguous | 128 | 183.072 ms (182.782–184.931) | 59.728 ms (58.131–69.517) | 3.07× |
| Random | 1 | 1.368 ms (1.358–1.399) | 0.797 ms (0.786–0.808) | 1.72× |
| Random | 8 | 8.886 ms (8.738–11.392) | 3.010 ms (2.989–3.624) | 2.95× |
| Random | 32 | 33.696 ms (33.531–33.917) | 14.238 ms (13.430–21.461) | 2.37× |
| Random | 128 | 195.960 ms (194.730–196.548) | 73.775 ms (72.117–74.485) | 2.66× |

At contiguous batch 128, OpenSlide spent 161.23 ms decoding RGBA, 12.61 ms packing 24 MiB of pinned
RGB, and 2.02 ms on H2D. cuCIM spent 46.70 ms returning the 24 MiB device batch. Common preprocessing
and consumer stages account for the remaining wall time. The CuPy pool reserved 1,130,365,440 bytes
for cuCIM and 1,155,531,264 bytes for the CPU pipeline. These figures exclude cuCIM's internal device
allocator.

### Aperio JPEG 2000, `590_crop_jp2k_imagescope.svs`

| Access | Batch | OpenSlide + pinned H2D | cuCIM device output | Speedup |
| --- | ---: | ---: | ---: | ---: |
| Contiguous | 1 | 1.334 ms (1.334–1.361) | 3.291 ms (3.286–3.559) | 0.41× |
| Contiguous | 8 | 8.499 ms (8.482–8.567) | 4.426 ms (4.351–4.782) | 1.92× |
| Contiguous | 32 | 33.017 ms (32.921–33.580) | 15.790 ms (15.295–18.382) | 2.09× |
| Random | 1 | 1.906 ms (1.855–6.490) | 2.724 ms (2.485–3.820) | 0.70× |
| Random | 8 | 10.081 ms (7.231–10.884) | 4.783 ms (4.079–5.078) | 2.11× |
| Random | 32 | 31.221 ms (30.947–32.814) | 15.865 ms (14.286–16.579) | 1.97× |

The crop contains 81 complete 256 × 256 regions, so batch 128 was omitted rather than padded or
wrapped. At contiguous batch 32, OpenSlide spent 26.84 ms decoding, 3.09 ms packing 6 MiB of RGB, and
0.52 ms on H2D. cuCIM returned the 6 MiB device batch in 13.16 ms. Single-region JPEG 2000 was slower
through cuCIM for both access patterns, while batches of eight and 32 were faster.

## Limits

- The run measures warm-cache throughput after correctness probes. Cold-start and cold-storage
  performance remain unmeasured. The extra diagnostic sample is named
  `first_sample_after_correctness_probe`.
- Pipeline order alternates by access-pattern and batch-size pair, and every raw case records whether
  it ran first or second. The three processes repeat that deterministic pair order; they do not use
  per-sample crossover or randomization.
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
