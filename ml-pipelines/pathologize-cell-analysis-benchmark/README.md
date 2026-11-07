# Pathologize cell-analysis benchmark

This project evaluates nucleus detection, instance segmentation, and cell
classification as separate objectives. It has a deterministic synthetic path
for contract tests and a bounded public-data path for a real baseline.

```bash
mise run //ml-pipelines/pathologize-cell-analysis-benchmark:check
mise run //ml-pipelines/pathologize-cell-analysis-benchmark:dvc -- dag
mise run //ml-pipelines/pathologize-cell-analysis-benchmark:public:repro
mise run //ml-pipelines/pathologize-cell-analysis-benchmark:public:report
```

The PPM image fixtures contain colored circles, and PGM masks contain synthetic
instance IDs. The labels `synthetic_type_a` and `synthetic_type_b` have no
biological meaning. Perfect baseline values test matching and scorecard wiring,
not cell-model performance.

## Public NuCLS baseline

The public experiment uses the corrected single-rater tier of
[NuCLS](https://doi.org/10.5524/102207). The
[official dataset site](https://sites.google.com/view/nucls/single-rater) and
GigaDB record publish it under CC0 1.0. The source archives retain TCGA slide
barcodes, official slide folds, hospital codes, the original three biological
super-classes, and the source's `AMBIGUOUS` and `other_nucleus` categories.

The acquisition stage downloads RGB, annotation, and split archives from the
publisher. It checks the published byte count and MD5 plus a pinned SHA-256,
extracts them to a DVC output, and discards the archives. Git stores the source
manifest, DVC reconstruction lock, and aggregate report. It does not store image
or annotation bytes.

Fold 1 test slides are the test cohort. Fold 2 test slides are validation, and
the remaining fold 1 training slides are train. The paper reports one slide per
patient. The run derives patient IDs from TCGA barcodes and rejects any patient
or slide overlap across splits.

The transparent baseline assigns training-cohort class probabilities to every
detected nucleus. The only candidate is a CPU logistic model over bounding-box,
RGB, and optical-density summaries. Both use the same fixed hematoxylin
threshold and watershed instances. Classification is scored on matched nuclei
with one of the three source super-classes. Instance segmentation is scored
only where NuCLS provides a polygon. Rectangle and point annotations are not
turned into masks.

The bounded run rejected the candidate. Macro F1 improved from 0.1767 to 0.4368,
but multiclass Brier score worsened from 0.6477 to 0.7067 and 10-bin expected
calibration error worsened from 0.0543 to 0.2194. No second candidate was tried.
See [the full evidence report](reports/nucls-public-baseline.md) for per-class,
site, failure, exclusion, and resource results.

Neither path makes a clinical-validity claim.
