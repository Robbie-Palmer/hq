# Pathologize cell-analysis benchmark

This project evaluates nucleus localization, instance segmentation, and cell
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

Every NuCLS point, rectangle, or polygon contributes one centroid to the
localization task. A prediction is localized when its centroid is matched
one-to-one within the declared tolerance; no boundary is required. Instance
segmentation is a separate conditional task scored only for successfully
localized source polygons. Rectangle and point annotations are never treated as
masks or evidence about shape and size.

The published annotation schema used by this baseline has no focal-plane or
shadow-nucleus label. The benchmark therefore reports that limitation instead
of interpreting a faint or out-of-plane nucleus as an annotated absence.
Localization precision measures agreement with the published single-rater
centroids. Unmatched predictions may still represent biologically present
nuclei.

The transparent classification baseline assigns training-cohort class
probabilities to every localized nucleus. The only classification candidate is
a CPU logistic model over predicted bounding-box, RGB, and optical-density
summaries. Classification is scored only on localized nuclei with one of the
three source super-classes and always requires class probabilities.

The bounded run rejected the candidate. Macro F1 improved from 0.1768 to 0.4367,
but multiclass Brier score worsened from 0.6476 to 0.7061 and 10-bin expected
calibration error worsened from 0.0540 to 0.2190. No second candidate was tried.
See [the full evidence report](reports/nucls-public-baseline.md) for per-class,
site, failure, exclusion, and resource results.

Neither path makes a clinical-validity claim.
