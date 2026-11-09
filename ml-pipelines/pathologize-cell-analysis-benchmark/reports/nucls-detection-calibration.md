# NuCLS detection operating-point calibration

This non-clinical experiment selected one confidence and NMS operating point on the frozen validation fold, then
evaluated it once on the frozen test fold. Model weights, training parameters, folds, ontology, empty-image handling,
ignored regions, and coordinate semantics did not change.

## Locked operating point

Validation passed with confidence `0.15` and NMS IoU `0.50`.

## Frozen-test localization

| Metric | Baseline | Calibrated | Delta |
| --- | ---: | ---: | ---: |
| Precision | 0.3606 | 0.6645 | 0.3039 |
| Recall | 0.9361 | 0.8288 | -0.1073 |
| F1 | 0.5207 | 0.7376 | 0.2169 |

Paired slide-bootstrap 95% intervals for calibrated minus baseline were precision [0.2947, 0.3150], recall
[-0.1292, -0.0865], and F1 [0.2033, 0.2297].

## Per-class localization F1

| Source class | Baseline | Calibrated |
| --- | ---: | ---: |
| `AMBIGUOUS` | 0.1812 | 0.1282 |
| `nonTIL_stromal` | 0.3060 | 0.3760 |
| `other_nucleus` | 0.0000 | 0.0000 |
| `sTIL` | 0.5616 | 0.7203 |
| `tumor_any` | 0.3986 | 0.5908 |

`AMBIGUOUS` was the only class with lower frozen-test F1, decreasing by 0.0530. `other_nucleus` had only seven test
truth points and remained at zero F1.

## Held-out-site localization F1

| Site | Baseline | Calibrated |
| --- | ---: | ---: |
| `A1` | 0.4879 | 0.6970 |
| `AC` | 0.5933 | 0.8085 |
| `BH` | 0.5221 | 0.7282 |
| `OL` | 0.5094 | 0.7415 |

## Resources and failures

Validation inference used 11.87 wall seconds and 11.52 GPU seconds. The single test inference used 7.62 wall seconds
and 5.67 GPU seconds. Peak allocated VRAM across calibration inference was 1,582,906,880 bytes.

An initial validation warmup exhausted CUDA memory before emitting predictions. Its task wall time was 19.15 seconds;
GPU time was not measured. Fixing inference batch size at 64 prevented recurrence without changing the candidate grid
or validation gates.

Prediction normalization rejected 0 test instances.

Unmatched predictions remain unmatched annotations. They are not called artifacts unless blinded review distinguishes
true artifacts from biologically present but unlabelled nuclei.

This experiment does not establish clinical validity.
