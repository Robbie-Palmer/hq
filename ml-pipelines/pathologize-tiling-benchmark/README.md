# Pathologize tiling benchmark

This project evaluates tissue-aware tile selection and declared physical scale.
Its manifest covers tile-selection F1, tissue coverage, selected background
fraction, and relative error in target and source microns per pixel. The
evaluator checks reported source scale against item metadata instead of merely
checking that an adapter echoed the requested target. The DVC graph writes
execution records, evaluation results, a comparison scorecard, a benchmark
index, and a DVC metrics file as separate outputs.

```bash
mise run //ml-pipelines/pathologize-tiling-benchmark:check
mise run //ml-pipelines/pathologize-tiling-benchmark:dvc -- dag
```

The contract uses microns per pixel rather than assuming scanner objective
power is complete or accurate. The deterministic PPM and PGM fixtures test the
selection arithmetic. They do not establish a useful tiling policy for a real
cohort.

The project stores no clinical image, annotation, or invented registry record.
It makes no clinical-validity claim.
