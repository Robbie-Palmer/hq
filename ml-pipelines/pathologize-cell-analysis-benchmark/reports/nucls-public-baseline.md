# NuCLS public nucleus baseline

This is a bounded, non-clinical baseline on the corrected single-rater NuCLS dataset. The source is
GigaDB DOI `10.5524/102207` under CC0 1.0. The official slide folds have no patient or slide overlap
among train, validation, and test.

## Decision

`reject_candidate`. The candidate failed one or more decision or guardrail gates. The bounded search
stops after this single locally runnable candidate.

## Aggregate results

| Metric | Class-prior baseline | Morphology logistic candidate |
| --- | ---: | ---: |
| `detection_f1` | 0.2629 | 0.2629 |
| `segmentation_mean_instance_iou` | 0.5307 | 0.5307 |
| `segmentation_mean_instance_dice` | 0.6417 | 0.6417 |
| `classification_macro_f1` | 0.1767 | 0.4368 |
| `classification_brier` | 0.6477 | 0.7067 |
| `classification_ece_10_bin` | 0.0543 | 0.2194 |

## Per-class classification

| Source super-class | Baseline F1 | Candidate F1 | Test support |
| --- | ---: | ---: | ---: |
| `nonTIL_stromal` | 0.0000 | 0.2291 | 1,229 |
| `sTIL` | 0.5301 | 0.5540 | 2,084 |
| `tumor_any` | 0.0000 | 0.5272 | 2,466 |

## Held-out site slices

The `site` field is the TCGA tissue-source-site code in the NuCLS split files. The published files
used here have no scanner metadata.

| Site | Baseline macro F1 | Candidate macro F1 | Evaluated nuclei |
| --- | ---: | ---: | ---: |
| `A1` | 0.2010 | 0.5226 | 667 |
| `AC` | 0.1698 | 0.3592 | 711 |
| `BH` | 0.1843 | 0.4163 | 2,534 |
| `OL` | 0.1591 | 0.3435 | 1,867 |

## Failed gates

- `classification_brier_no_regression`: Multiclass Brier change must be no greater than zero. -
  `classification_ece_no_regression`: Ten-bin expected calibration error change must be no greater
  than zero.

## Scope and exclusions

- Detection uses every published nucleus annotation in the test fields.
- Instance segmentation uses only source annotations marked `polyline`. Rectangle annotations are
  not converted into masks.
- Classification uses matched detections labeled `nonTIL_stromal`, `sTIL`, or `tumor_any` and emits
  a probability for every supported class.
- Unmappable matched categories were excluded without relabeling: `AMBIGUOUS` 780, `other_nucleus` 7.
- The corrected single-rater tier has pathologist-supervised quality control. It is not the
  multi-rater inferred P-truth tier.
- This experiment makes no clinical-validity claim.

## Resources

| Adapter | Wall time | CPU time | GPU time | Peak RSS | Peak VRAM |
| --- | ---: | ---: | ---: | ---: | ---: |
| Class-prior baseline | 10.03 s | 10.00 s | 0 s | 179,982,336 bytes | 0 bytes |
| Morphology logistic candidate | 18.69 s | 22.15 s | 0 s | 196,206,592 bytes | 0 bytes |

Each adapter had a 1800-second wall ceiling. The aggregate accelerator ceiling was 86400 seconds.
Neither method justified GPU inference, so the run used no GPU.
