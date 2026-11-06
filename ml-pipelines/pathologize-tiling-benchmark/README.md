# Pathologize tiling benchmark

This project evaluates tissue-aware tile selection and declared physical scale.
Its manifest covers tile-selection F1, tissue coverage, selected background
fraction, and relative error in target microns per pixel. The DVC graph
produces its own validation report, run resources, scorecard, and DVC metrics
file.

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
