# Pathologize cell-analysis benchmark

This project evaluates nucleus detection, instance segmentation, and synthetic
cell classification as separate objectives. Its manifest covers detection F1,
semantic Dice, mean matched-instance IoU, macro class F1, and diagnostic binary
panoptic quality. Panoptic quality cannot decide promotion on its own.

```bash
mise run //ml-pipelines/pathologize-cell-analysis-benchmark:check
mise run //ml-pipelines/pathologize-cell-analysis-benchmark:dvc -- dag
```

The PPM image fixtures contain colored circles, and PGM masks contain synthetic
instance IDs. The labels `synthetic_type_a` and `synthetic_type_b` have no
biological meaning. Perfect baseline values test matching and scorecard wiring,
not cell-model performance.

The project stores no clinical image, annotation, or invented registry record.
It makes no clinical-validity claim.
