# NuCLS geometry-completeness intervention

## Measured diagnosis

Incomplete geometry supervision is the strongest measured data-quality limitation for instance segmentation. The
source has 39,694 rectangles, 19,680 polygons, and 111 points. The conversion correctly excludes rectangles and
points from mask training rather than inventing boundaries. That leaves most segmentation images partially labelled
even though detection can use every positive-area box.

The other candidate explanations are weaker. All five ontology mappings are exact. The conversion found no invalid
boxes, no non-positive boxes, one exact duplicate row in the test fold, and one training geometry shared by
conflicting labels. It clipped 776 detection boxes and 226 polygons by at most the declared two-pixel border
allowance. `other_nucleus` is imbalanced at 426 train instances versus 11,007 `tumor_any` instances, but the test fold
has only seven `other_nucleus` instances. `AMBIGUOUS` is not rare. Its 7,911 source instances comprise 7,515
`unlabeled` and 396 `apoptotic_body` records, which confirms heterogeneity without authorizing a new ontology mapping.

Held-out-site variation does not isolate a preprocessing failure. Mean image RGB differs between train and test by
about 4.6, 11.2, and 5.0 intensity levels, while detection F1 spans 0.48785 to 0.59330 and conditional polygon IoU
spans 0.74742 to 0.76976 across sites. The configured stain and value augmentation already covers a much wider range.
Detection's main measured failure is different: 0.93608 recall and 0.36063 precision at the pinned 0.05 inference
confidence threshold. Threshold calibration could address that operating point, but it is not a data-quality
intervention and was outside this predeclaration.

## Predeclared hypothesis

The merged baseline converts 33,884 training annotations into detection boxes but only 10,429 into segmentation
polygons. It excludes 23,455 training rectangles from segmentation without fabricating masks. As a result, 807 of
976 training images have a mix of supervised polygons and omitted non-polygon nuclei, 146 have no segmentation
labels, and only 23 are fully polygon-labelled.

Conditional mask geometry is already strong once the model localizes a polygon. Test mean IoU is 0.75976 and 97.06%
of localized polygons exceed IoU 0.5. Localization is weaker. The segmentation model recalls 59.31% of all test
nuclei and localizes 79.61% of polygon instances. Detection sees the more complete spatial labels and recalls 93.61%
of test nuclei.

The primary intervention initializes the segmentation model's shared backbone and neck from the completed NuCLS
detector. It retains the pinned YOLO26n-seg task head and mask-specific weights. The transfer excludes every tensor
under the final task-head module and records the source checkpoint digest and transferred tensor count. It does not
create mask geometry, alter labels, move a patient or slide, remove an image, or change evaluation.

## Alternatives rejected before training

- Ontology remapping is unsupported. The data product preserves all five source labels with exact mappings.
- Class rebalancing targets `other_nucleus`, which has 426 training instances but only seven test instances. That test
  slice is too small to support the primary experiment, and imbalance does not explain the 93.61% aggregate
  detection recall.
- Geometry filtering is unsupported. The source has no non-positive boxes, one exact duplicate row in the test fold,
  and one conflicting-geometry label pair in training.
- Stain normalization is unsupported by the held-out-site evidence. Detection F1 ranges from 0.48785 to 0.59330 and
  conditional polygon IoU ranges from 0.74742 to 0.76976 across the four test sites, without one site accounting for
  the aggregate failure.
- Rectangle-shaped surrogate masks would invent boundaries and violate the source geometry contract.

## Stop rules

Before GPU work:

1. Golden conversion, coordinate round-trip, leakage, configuration, checkpoint-security, and initialization-transfer
   tests must pass.
2. The transfer audit must show that all shared backbone and neck tensors match by name and shape, no task-head tensor
   is transferred, and the segmentation head remains at its pinned starting weights.
3. No NuCLS or Ultralytics process may be active, and the configured GPU must have enough free memory for the 12 GiB
   ceiling.

Before frozen-test inference:

1. Segmentation validation mask mAP50-95 must be at least 0.12977, an absolute gain of 0.005 over the merged baseline's
   0.12477.
2. Segmentation validation mask mAP50 must be at least the merged baseline's 0.26981.
3. Detection validation box mAP50-95 must remain within 0.005 of the unchanged baseline value, 0.18600.

The intervention is rejected after frozen-test evaluation if it causes a conversion failure, reduces detection
localization F1 by more than 0.005 from 0.52067, improves segmentation localization F1 by less than 0.01 from 0.61123,
or reduces conditional polygon mean IoU below 0.75976. Per-class and held-out-site results receive the same report
even when the intervention fails. Uncertainty uses a fixed-seed slide-level bootstrap and does not turn this one-seed
experiment into a clinical or population claim.

## Results

The intervention failed the validation gate. Frozen-test prediction and evaluation did not run.

| Validation metric | Merged baseline | Intervention | Change | Gate |
| --- | ---: | ---: | ---: | --- |
| Detection box mAP50 | 0.42835 | 0.43029 | +0.00194 | Control only |
| Detection box mAP50-95 | 0.18600 | 0.18965 | +0.00365 | Pass, within 0.005 |
| Segmentation mask mAP50 | 0.26981 | 0.27583 | +0.00602 | Pass |
| Segmentation mask mAP50-95 | 0.12477 | 0.12666 | +0.00189 | Fail, required at least 0.12977 |

The segmenter reached its best mask mAP50-95 at epoch 9 and stopped after epoch 17 under the eight-epoch
validation-patience rule. The merged baseline reached its best at epoch 8 and stopped after epoch 16. Transfer
slightly lowered first-epoch mask mAP50-95 from 0.05208 to 0.05082. It reached 0.09524 by epoch 3 and 0.12288 by epoch
5, then plateaued. The faster middle of the curve did not produce the predeclared final gain.

The live initialization audit recorded 468 transferred backbone and neck tensors containing 2,277,214 values. It
retained all 376 tensors under the segmentation head. The source detector checkpoint SHA-256 is
`15d23be2a1fb3478a35fc7c0e6ebc912f929628213293d2419abb0866ddd3bf7`.

| Training resource | Merged baseline | Intervention |
| --- | ---: | ---: |
| Detector wall time | 962.08 s | 903.71 s |
| Segmenter wall time | 875.60 s | 754.99 s |
| Aggregate charged GPU time | 1,867.40 s | 1,688.48 s |
| Detector peak allocated VRAM | 1,555,411,968 B | 1,556,418,048 B |
| Segmenter peak allocated VRAM | 3,541,742,592 B | 3,540,801,024 B |

The charged GPU totals include the predeclared 30-second upper bound for prior failed work. The intervention has no
inference resource record because the validation stop rule prevented inference.

The merged frozen-test reference remains the only test result:

| Metric | Point estimate | 95% slide-bootstrap interval |
| --- | ---: | ---: |
| Detection localization F1 | 0.52067 | 0.50295 to 0.54148 |
| Segmentation localization F1 | 0.61123 | 0.56896 to 0.64731 |
| Conditional polygon mean IoU | 0.75976 | 0.73752 to 0.77704 |

Intervals use 10,000 percentile-bootstrap resamples of the 22 held-out slides with seed `20261109`. They describe
variation across this fixed public test cohort. They do not account for training-seed variation. The intervention has
no test estimate or interval.

The merged per-class reference shows where the model fails:

| Source class | Detection localization F1 | Conditional polygon mean IoU |
| --- | ---: | ---: |
| `AMBIGUOUS` | 0.18117 | 0.70345 |
| `nonTIL_stromal` | 0.30601 | 0.72986 |
| `other_nucleus` | 0.00000 | 0.00000 |
| `sTIL` | 0.56159 | 0.77297 |
| `tumor_any` | 0.39855 | 0.75749 |

`other_nucleus` has only seven test nuclei, so that slice cannot support a useful intervention claim. `AMBIGUOUS` has
segmentation polygon-localization coverage 0.03214 despite conditional IoU 0.70345 on its nine localized polygons.

| Held-out site | Detection localization F1 | Conditional polygon mean IoU |
| --- | ---: | ---: |
| `A1` | 0.48785 | 0.74742 |
| `AC` | 0.59330 | 0.75465 |
| `BH` | 0.52207 | 0.76976 |
| `OL` | 0.50944 | 0.75539 |

No intervention site or class slices exist because test inference did not run.

This result rejects detector-to-segmenter backbone and neck transfer as the implementation for this branch. It does
not show that partial segmentation labels are harmless. It shows that this bounded transfer did not recover enough
value from the more complete box supervision to clear the validation threshold. No pull request or merge is warranted
from this experiment.

## GPU coordination

This branch claimed GPU `GPU-35a743e5-a848-d594-4ba1-b8b449ef0e4f` on host
`t3-code-7f494cdd8f-s9vxj` at `2026-11-09T18:36:47Z`. `nvidia-smi` reported no compute processes, 11,864 MiB free,
14 MiB used, and 13% momentary utilization. The process table contained no other NuCLS, Ultralytics, YOLO, or
torchrun job. The claim covered the bounded `train_nucls_learned` DVC stage on branch
`t3/pathologize-nucls-data-quality`.

The branch released the claim at `2026-11-09T19:05:19Z`. `nvidia-smi` again reported no compute processes, 11,864
MiB free, 14 MiB used, and 13% momentary utilization. Training stayed inside the four-hour per-task, 86,400-second
aggregate GPU, and 12 GiB peak-allocation limits.
