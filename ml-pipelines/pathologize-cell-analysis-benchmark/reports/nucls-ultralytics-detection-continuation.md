# NuCLS detector continuation

This non-clinical continuation starts from the pinned best checkpoint of the completed baseline. The optimizer state was
unavailable, so this is a separate fine-tuning experiment.

## Result

| Measure | Base detector | Continuation |
| --- | ---: | ---: |
| Held-out localization F1 | 0.5207 | 0.5129 |
| Validation mAP50-95 | 0.1860 | 0.1869 |

The continuation is not a promotion candidate. Its small validation gain did not transfer to the held-out fold, so the
original detector checkpoint remains selected (`held_out_localization_f1_did_not_improve`).

## Stopping evidence

The continuation ran 10 additional epochs and stopped for `validation_patience`. Its validation assessment is
`validation_plateau_supports_convergence`.

Prediction conversion rejected 0 instances.

This experiment does not establish clinical validity.
