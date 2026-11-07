# Pathologize tiler

This package owns CPU-first whole-slide tile extraction. It reads OpenSlide
formats, writes native tile grids, builds PNG pyramids, and extracts a requested
physical field of view from source MPP and pyramid metadata.

The physical read API accepts explicit metadata overrides so experiment code
can test missing, corrupted, and incorrect scale metadata without changing the
source slide. Production callers omit the override and use metadata reported by
OpenSlide.

```bash
mise //packages/pathologize-tiler:check
```
