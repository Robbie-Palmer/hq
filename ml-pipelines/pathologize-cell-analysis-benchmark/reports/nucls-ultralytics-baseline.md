# NuCLS Ultralytics baseline

This non-clinical experiment trains the predeclared YOLO26 nano detection and instance-segmentation models on the frozen
public NuCLS folds. Pathologize records, not Ultralytics-native metrics, are the evaluation boundary.

## Task results

| Metric | Transparent baseline | Ultralytics |
| --- | ---: | ---: |
| Detection localization F1 | 0.2636 | 0.5207 |
| Conditional polygon mean IoU | 0.5313 | 0.7598 |

## Learning curves and convergence

| Task | Epochs | Stop | Train loss first/final | Val loss first/final | Convergence |
| --- | ---: | --- | ---: | ---: | --- |
| Detection | 40 | `epoch_ceiling` | 5.0105 / 3.1257 | 5.9297 / 3.3774 | `not_established_before_epoch_ceiling` |
| Segmentation | 16 | `validation_patience` | 11.9309 / 7.6537 | 8.1903 / 5.6117 | `validation_plateau_supports_convergence` |

| Task metric | First | Best (epoch) | Final | Best-checkpoint value |
| --- | ---: | ---: | ---: | ---: |
| Detection box mAP50 | 0.0853 | 0.4284 (38) | 0.4255 | 0.4248 |
| Detection box mAP50-95 | 0.0143 | 0.1860 (35) | 0.1822 | 0.1860 |
| Segmentation mask mAP50 | 0.1307 | 0.2698 (8) | 0.2542 | 0.2698 |
| Segmentation mask mAP50-95 | 0.0521 | 0.1248 (8) | 0.1173 | 0.1248 |

## Per-class and held-out-site slices

| Source class | Detection localization F1 | Segmentation mean IoU |
| --- | ---: | ---: |
| `AMBIGUOUS` | 0.1812 | 0.7035 |
| `nonTIL_stromal` | 0.3060 | 0.7299 |
| `other_nucleus` | 0.0000 | 0.0000 |
| `sTIL` | 0.5616 | 0.7730 |
| `tumor_any` | 0.3986 | 0.7575 |

| Held-out site | Detection localization F1 | Segmentation mean IoU |
| --- | ---: | ---: |
| `A1` | 0.4879 | 0.7474 |
| `AC` | 0.5933 | 0.7547 |
| `BH` | 0.5221 | 0.7698 |
| `OL` | 0.5094 | 0.7554 |

## Resources and failures

Aggregate measured GPU time was 1875.5103 seconds against a 86,400-second ceiling.

Prediction conversion rejected 0 instances. The evidence JSON records each rejection.

## Provenance

- Package: `ultralytics==8.4.202` under `AGPL-3.0-or-later`.
- Detection weights: `yolo26n.pt` at `9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef`.
- Segmentation weights: `yolo26n-seg.pt` at `361fbfabab285c3237700b6bb91d7ecfa602cd945fffda8dbe1242829b71e73f`.
- The experiment JSON records preprocessing, augmentation, optimizer, schedule, threshold, NMS, seed, package-lock,
  split-manifest, checkpoint, and prediction pins.

This experiment does not establish clinical validity.
