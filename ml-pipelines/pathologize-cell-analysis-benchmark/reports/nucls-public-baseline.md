# NuCLS public nucleus baseline

This is a bounded, non-clinical baseline on the corrected single-rater NuCLS dataset. The source is
GigaDB DOI `10.5524/102207` under CC0 1.0. The official slide folds have no patient or slide overlap
among train, validation, and test.

## Decision

`reject_candidate`. The candidate failed one or more decision or guardrail gates. The bounded search
stops after this single locally runnable candidate.

## Nucleus localization

Every source annotation contributes one centroid target. Localization does not require a polygon or
assume that a rectangle is a nucleus boundary.

| Metric | Shared morphology method |
| --- | ---: |
| Match tolerance | 12.0 pixels |
| Precision | 0.1538 |
| Recall | 0.9210 |
| F1 | 0.2636 |
| Source centroids | 7,150 |
| Predicted centroids | 42,806 |
| Matched centroids | 6,585 |

## Instance segmentation

This is conditional on successful localization and uses only source polygons. Point and rectangle
annotations are not segmentation ground truth.

| Metric | Shared morphology method |
| --- | ---: |
| Eligible source polygons | 2,736 |
| Localized source polygons | 2,648 |
| Localization coverage | 0.9678 |
| Mean instance IoU | 0.5313 |
| Mean instance Dice | 0.6423 |
| Success at IoU 0.5 | 0.5971 |

## Classification

Classification is conditional on a localized nucleus with a supported source class and is evaluated
from class probabilities.

| Metric | Class-prior baseline | Morphology logistic candidate |
| --- | ---: | ---: |
| Macro F1 | 0.1768 | 0.4367 |
| Multiclass Brier | 0.6476 | 0.7061 |
| ECE, 10 bins | 0.0540 | 0.2190 |
| Negative log likelihood | 1.0667 | 1.3065 |

## Per-class classification

| Source super-class | Baseline F1 | Candidate F1 | Test support |
| --- | ---: | ---: | ---: |
| `nonTIL_stromal` | 0.0000 | 0.2277 | 1,231 |
| `sTIL` | 0.5304 | 0.5547 | 2,092 |
| `tumor_any` | 0.0000 | 0.5276 | 2,474 |

## Held-out site slices

The `site` field is the TCGA tissue-source-site code in the NuCLS split files. The published files
used here have no scanner metadata.

| Site | Localization F1 | Polygon localization coverage | Mean instance IoU |
| --- | ---: | ---: | ---: |
| `A1` | 0.3155 | 0.9560 | 0.4872 |
| `AC` | 0.2851 | 0.9927 | 0.5617 |
| `BH` | 0.2136 | 0.9778 | 0.4812 |
| `OL` | 0.3511 | 0.9558 | 0.5925 |

| Site | Baseline macro F1 | Candidate macro F1 | Evaluated nuclei |
| --- | ---: | ---: | ---: |
| `A1` | 0.2016 | 0.5225 | 669 |
| `AC` | 0.1696 | 0.3599 | 712 |
| `BH` | 0.1846 | 0.4162 | 2,544 |
| `OL` | 0.1587 | 0.3434 | 1,872 |

## Failed gates

- `classification_brier_no_regression`: Multiclass Brier change must be no greater than zero.
- `classification_ece_no_regression`: Ten-bin expected calibration error change must be no greater than zero.

## Scope and exclusions

- Localization reduces every published point, rectangle, or polygon annotation to one centroid and
  scores one-to-one matches within tolerance.
- Instance segmentation is conditional on localization and uses only source annotations marked
  `polyline`; rectangles and points are not converted into masks.
- Shape and size are not inferred from point or rectangle annotations. The source schema used here
  has no focal-plane or shadow-nucleus label, so those effects are not scored as a separate task.
- Unmatched predictions count against localization precision relative to the published single-rater
  annotations; they are not evidence that a nucleus is biologically absent.
- Classification uses localized nuclei labeled `nonTIL_stromal`, `sTIL`, or `tumor_any` and emits a
  probability for every supported class.
- Unmappable matched categories were excluded without relabeling: `AMBIGUOUS` 781, `other_nucleus` 7.
- The corrected single-rater tier has pathologist-supervised quality control. It is not the
  multi-rater inferred P-truth tier.
- This experiment makes no clinical-validity claim.

## Resources

| Adapter | Wall time | CPU time | GPU time | Peak RSS | Peak VRAM |
| --- | ---: | ---: | ---: | ---: | ---: |
| Class-prior baseline | 11.18 s | 11.14 s | 0 s | 233,971,712 bytes | 0 bytes |
| Morphology logistic candidate | 23.06 s | 26.59 s | 0 s | 240,455,680 bytes | 0 bytes |

Each adapter had a 1800-second wall ceiling. The aggregate accelerator ceiling was 86400 seconds.
Neither method justified GPU inference, so the run used no GPU.
