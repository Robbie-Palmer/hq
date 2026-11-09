# NuCLS epoch-wise double descent

This detector-only DVC experiment kept the merged NuCLS baseline fixed
except for a 120-epoch horizon, disabled model-selection patience, and
per-epoch checkpoints. It ran the same YOLO26n setup with seeds
20261107, 20261109, 20261111.

## Result

Conclusion: `negative_failure_to_interpolate`.

The three-epoch first minimum was epochs 35 to 37.
The later peak was epochs 46 to 48.
The later minimum was epochs 82 to 84.

The complete patient-bootstrap curve is the DVC plot at
`outputs/nucls-double-descent/analysis/curves.csv`. It contains all 120 epochs for train error,
validation error, 95% intervals, mAP50, and mAP50-95.

## Metrics

| Metric | Merged baseline | Extended run | Delta |
| --- | ---: | ---: | ---: |
| Best validation mAP50 | 0.4284 | 0.4262 | -0.0021 |
| Best validation mAP50-95 | 0.1860 | 0.1861 | 0.0001 |
| Fixed-endpoint test localization F1 | 0.5207 | 0.5394 | 0.0187 |

The sealed test split was evaluated only after curve analysis. Each seed used its fixed epoch-120 checkpoint.

## Per-class and held-out-site slices

| Source class | Mean test localization F1 | Seed range |
| --- | ---: | ---: |
| `AMBIGUOUS` | 0.1613 | 0.1537 to 0.1695 |
| `nonTIL_stromal` | 0.3006 | 0.2845 to 0.3152 |
| `other_nucleus` | 0.0000 | 0.0000 to 0.0000 |
| `sTIL` | 0.5730 | 0.5691 to 0.5792 |
| `tumor_any` | 0.3980 | 0.3761 to 0.4099 |

| Held-out site | Mean test localization F1 | Seed range |
| --- | ---: | ---: |
| `A1` | 0.5066 | 0.4691 to 0.5425 |
| `AC` | 0.5939 | 0.5735 to 0.6045 |
| `BH` | 0.5504 | 0.5397 to 0.5575 |
| `OL` | 0.5214 | 0.4704 to 0.5516 |

## Resources and provenance

The run used 12788.6 measured GPU-seconds against the 86,400-second cap. Peak allocated VRAM was 1.61 GiB.

The three runs recorded 360 checkpoint digests.
The package lock digest was
`bc85c458fb74706f8166ef1208ff62b91d8dc371a3dae596974173eebeec1798` and the starting weight digest was
`9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef`.

Prediction conversion rejected 0 curve instances and 0 sealed-test instances.

This experiment does not establish clinical validity.
