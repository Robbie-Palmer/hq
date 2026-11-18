# NuCLS annotation GPU coordination

## 2026-11-09 box-to-mask comparison

- Status: released
- Claimed at: 2026-11-09T23:05:57Z
- Branch: `t3/pathologize-nucls-data-quality`
- Starting revision: `2cfdb12b`
- Host GPU: NVIDIA GeForce RTX 4080 Laptop GPU
- GPU UUID: `GPU-35a743e5-a848-d594-4ba1-b8b449ef0e4f`
- Capacity: 12,282 MiB
- Free at claim: 11,864 MiB
- Existing compute processes: none
- Repository process scan: no NuCLS, Ultralytics, YOLO, torchrun, MedSAM, or SAM 2 job
- Scope: bounded MedSAM and SAM 2 box-prompt inference on NuCLS annotation-pilot samples
- Owner: current T3 Code session

Released at 2026-11-09T23:11:33Z. No compute processes remained and the GPU again had
11,864 MiB free. The smoke comparison processed 36 records without training:

| Adapter | Wall time | Peak allocated VRAM | Polygon references | Mean IoU | Success at IoU 0.5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Threshold baseline | CPU reference | 0 B | 29 | 0.68248 | 0.89655 |
| MedSAM ViT-B | 4.09 s | 1,239,508,480 B | 29 | 0.62301 | 0.82759 |
| SAM 2.1 Hiera-small | 1.35 s | 436,875,264 B | 29 | 0.78616 | 1.00000 |

These are smoke-run measurements on a small fixed sample. They are not benchmark or scientific
claims.

Release this claim after the bounded comparison or before handing GPU work to another session.

## 2026-11-09 CellSAM comparison

- Status: released
- Claimed at: 2026-11-09T23:46:15Z
- Branch: `t3/pathologize-nucls-data-quality`
- Starting revision: `2cfdb12b`
- Host GPU: NVIDIA GeForce RTX 4080 Laptop GPU
- GPU UUID: `GPU-35a743e5-a848-d594-4ba1-b8b449ef0e4f`
- Capacity: 12,282 MiB
- Free at claim: 11,864 MiB
- Existing compute processes: none
- Repository process scan: no NuCLS, Ultralytics, YOLO, torchrun, CellSAM, MedSAM, or SAM 2 job
- Scope: fixed 36-record CellSAM, MedSAM, SAM 2, and threshold smoke comparison
- Owner: current T3 Code session

Release this claim after the bounded comparison or before handing GPU work to another session.

The first attempt stopped when the CellSAM v1.2 wrapper dereferenced a valid no-mask result. The
comparison now records that result as an empty proposal. The deterministic checks passed again
before the second attempt.

Released at 2026-11-09T23:48:38Z. No compute processes remained and the GPU again had 11,864 MiB
free. The smoke comparison processed 36 records without training:

| Adapter | Wall time | Peak allocated VRAM | Polygon references | Mean IoU | Bootstrap 95% interval | Success at IoU 0.5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Threshold baseline | CPU reference | 0 B | 29 | 0.68248 | 0.63800 to 0.72078 | 0.89655 |
| MedSAM ViT-B | 2.70 s | 1,239,508,480 B | 29 | 0.62301 | 0.57071 to 0.67261 | 0.82759 |
| SAM 2.1 Hiera-small | 1.54 s | 436,875,264 B | 29 | 0.78616 | 0.76294 to 0.80791 | 1.00000 |
| CellSAM general v1.2 | 9.79 s | 3,769,089,536 B | 29 | 0.84006 | 0.80704 to 0.86944 | 1.00000 |

These are smoke-run measurements on a small fixed sample. They are not benchmark or scientific
claims. CellSAM's weights use the Modified Apache 2.0 Non-Commercial license.

## 2026-11-10 Annotation Workbench bundle regeneration

- Status: released
- Claimed at: 2026-11-10T08:27:02Z
- Branch: `t3/pathologize-nucls-data-quality`
- Starting revision: `2cfdb12b`
- Host GPU: NVIDIA GeForce RTX 4080 Laptop GPU
- GPU UUID: `GPU-35a743e5-a848-d594-4ba1-b8b449ef0e4f`
- Capacity: 12,282 MiB
- Free at claim: 11,864 MiB
- Existing compute processes: none
- Repository process scan: no NuCLS, Ultralytics, YOLO, torchrun, CellSAM, MedSAM, or SAM 2 job
- Scope: regenerate the fixed 36-record smoke comparison and its ignored review bundle after the
  Annotation Workbench adapter was added
- Owner: current T3 Code session

Release this claim after bundle validation or before handing GPU work to another session.

Released at 2026-11-10T08:27:57Z. The ignored bundle passed the Annotation Workbench contract with
12 items, 53 SHA-256-pinned assets, and no pre-existing reviews. The inference-only smoke run kept
the fixed 36-record sample; CellSAM used 3,769,089,536 B peak allocated VRAM and 10.54 seconds,
SAM 2 used 436,875,264 B and 1.52 seconds, and MedSAM used 1,239,508,480 B and 2.62 seconds. No
compute processes remained and the GPU again had 11,864 MiB free. These measurements only document
the bundle-generation run; they are not scientific claims.
