# Pathologize tiler

This package owns CPU-first whole-slide tile extraction. It reads OpenSlide
formats, writes native tile grids, builds PNG pyramids, and extracts a requested
physical field of view from source MPP and pyramid metadata.

The DICOM seam uses wsidicom for pyramid and frame lookup. It exposes encoded
frames separately from host decoding, including logical level numbers, independent
x and y pixel spacing, transfer syntax, photometric interpretation, frame position,
and associated-image roles. The host path uses wsidicom's CPU decoder and returns
RGB Pillow images for viewers and export.

Install the optional `cuda` extra on supported Linux NVIDIA systems to make direct
nvImageCodec batch decoding available. Device results expose the CUDA array
interface and do not pass through Pillow. Call `probe_nvimagecodec()` before using
that path; an unavailable runtime is an explicit signal to retain the host path.

The physical read API accepts explicit metadata overrides so experiment code
can test missing, corrupted, and incorrect scale metadata without changing the
source slide. Production callers omit the override and use metadata reported by
OpenSlide.

```bash
mise //packages/pathologize-tiler:check
```
