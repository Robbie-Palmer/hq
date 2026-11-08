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
`sha256:d450f5461261c9770d23d89353dc896f5640d7a394c9a813c276a3e5ff5e5af5`
(2,861,246,056 bytes). It was not pushed. The local rootless Docker daemon did not have the NVIDIA
runtime and could not bind Nix store paths, so a diagnostic descendant copied the host driver libraries
and attached `/dev/nvidia0`, `/dev/nvidiactl`, and `/dev/nvidia-uvm`. That descendant had local manifest
`sha256:a833d5f83d6b52756e10fa35a88e349ace0da7ed4df14a3bd4fc595c7f55fbde`
(3,289,193,715 bytes). This proves the bounded code path on the available GPU, not a K3s deployment.

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
| Raw JSON SHA-256 | `fcc284eb9d855dffc910336abed10962af799fba2f5df74b2b758c44e6082361` |
| Raw JSON SHA-256 | `c92a25f4227ebe209c3ef797496b56eaa4ed06dd43fca35ff6a549520cf1b8e0` |
| Raw JSON SHA-256 | `233126a717b7eb84c070a587e47ab26ac144c1b88a52d9089f80afca64ed57f0` |

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

The retained CPU viewer decoded one JPEG region in a median 1.24 ms and encoded its PNG in 7.63 ms.
For JPEG 2000, the corresponding medians were 1.35 ms and 16.45 ms. These are single-request,
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
| Contiguous | 1 | 1.652 ms (1.199–2.023) | 1.151 ms (0.905–1.397) | 1.44× |
| Contiguous | 8 | 10.880 ms (8.879–12.832) | 3.618 ms (3.184–3.765) | 3.01× |
| Contiguous | 32 | 42.485 ms (31.246–50.079) | 11.664 ms (9.816–17.741) | 3.64× |
| Contiguous | 128 | 223.550 ms (181.890–262.666) | 40.518 ms (29.617–55.976) | 5.52× |
| Random | 1 | 2.952 ms (2.400–6.488) | 1.499 ms (1.229–3.264) | 1.97× |
| Random | 8 | 12.624 ms (7.510–16.728) | 3.280 ms (3.279–4.035) | 3.85× |
| Random | 32 | 41.092 ms (32.927–56.416) | 10.524 ms (8.646–24.543) | 3.90× |
| Random | 128 | 240.640 ms (205.433–291.705) | 30.489 ms (29.547–75.230) | 7.89× |

At contiguous batch 128, OpenSlide spent 197.37 ms decoding RGBA, 16.47 ms packing 24 MiB of pinned
RGB, and 2.02 ms on H2D. cuCIM spent 22.97 ms returning the 24 MiB device batch. Common preprocessing
and consumer stages account for the remaining wall time. The CuPy pool reserved 1,130,365,440 bytes
for cuCIM and 1,155,531,264 bytes for the CPU pipeline. These figures exclude cuCIM's internal device
allocator.

### Aperio JPEG 2000, `590_crop_jp2k_imagescope.svs`

| Access | Batch | OpenSlide + pinned H2D | cuCIM device output | Speedup |
| --- | ---: | ---: | ---: | ---: |
| Contiguous | 1 | 1.836 ms (1.140–1.973) | 3.405 ms (3.234–3.440) | 0.54× |
| Contiguous | 8 | 10.656 ms (8.003–13.583) | 4.550 ms (4.349–4.812) | 2.34× |
| Contiguous | 32 | 40.216 ms (32.932–54.775) | 17.705 ms (15.085–20.819) | 2.27× |
| Random | 1 | 4.144 ms (2.187–6.314) | 2.689 ms (2.488–3.580) | 1.54× |
| Random | 8 | 11.682 ms (7.267–15.054) | 4.449 ms (4.083–4.934) | 2.63× |
| Random | 32 | 40.066 ms (32.633–56.518) | 14.621 ms (14.138–16.388) | 2.74× |

The crop contains 81 complete 256 × 256 regions, so batch 128 was omitted rather than padded or
wrapped. At contiguous batch 32, OpenSlide spent 33.33 ms decoding, 3.90 ms packing 6 MiB of RGB, and
0.53 ms on H2D. cuCIM returned the 6 MiB device batch in 14.35 ms. Single contiguous JPEG 2000 was
1.86 times slower through cuCIM, while batches of eight and 32 were faster.

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
