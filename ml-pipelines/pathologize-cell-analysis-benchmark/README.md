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

Every NuCLS point, rectangle, or polygon contributes its bounding-box midpoint
to the localization task. A prediction is localized when its centroid is
matched one-to-one within the declared tolerance; no boundary is required.
Instance segmentation is a separate conditional task scored only for
successfully localized source polygons. Rectangle and point annotations are
never treated as segmentation masks or boundary ground truth. The classifier
does use source bounding-box geometry for supported training annotations.

The published annotation schema used by this baseline has no focal-plane or
shadow-nucleus label. The benchmark therefore reports that limitation instead
of interpreting a faint or out-of-plane nucleus as an annotated absence.
Localization precision measures agreement with the published single-rater
bounding-box midpoints. Unmatched predictions may still represent biologically
present nuclei.

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

## Learned NuCLS baseline

The first learned baseline uses framework-native `ultralytics==8.4.202` with
pinned YOLO26n detection and YOLO26n-seg starting weights. Its derived
Ultralytics labels remain DVC artifacts. The conversion preserves the five
source labels, official folds, patient and slide boundaries, empty images, and
pixel coordinates. Points are excluded from box training because they have no
area; points and rectangles are excluded from mask training because they have
no polygon. No surrogate geometry is created.

`params/nucls-learned.yaml` is the typed experiment configuration. DVC
tracks the parameter subsets consumed by acquisition,
conversion, training, prediction, evaluation, and reporting separately. The
JSON report is a DVC metric rather than a second copy of the full experiment
record; cached evaluation evidence retains artifact hashes and audit detail.
Project code lives under `learned_baseline` and is named for those pipeline
stages. The configured framework remains in the parameter pins and the
`ultralytics-extensions` adapter package, so another experiment branch can keep
the same project module and DVC stage names.
Parameter variants use DVC Experiments, for example:

```bash
mise run //ml-pipelines/pathologize-cell-analysis-benchmark:dvc -- \
  exp run -S params/nucls-learned.yaml:training.initial_learning_rate=0.0005 \
  -S params/nucls-learned.yaml:training.weight_decay=0.001 report_nucls_learned
mise run //ml-pipelines/pathologize-cell-analysis-benchmark:dvc -- exp show
```

The training output is deliberately non-persistent so a parameter change starts
a clean DVC experiment. After an interrupted run with unchanged parameters, do
not rerun the training stage through `dvc repro`, because DVC removes that
output before executing the stage. Resume and commit the recovered stage first:

```bash
mise run //ml-pipelines/pathologize-cell-analysis-benchmark:learned:train
mise run //ml-pipelines/pathologize-cell-analysis-benchmark:dvc -- \
  commit train_nucls_learned
mise run //ml-pipelines/pathologize-cell-analysis-benchmark:dvc -- \
  repro report_nucls_learned
```

Per-task state preserves completed tasks, checkpoint resume evidence, and a
conservative GPU-time charge for failed attempts. The aggregate ceiling applies
to both restored and new work. Use a new DVC experiment or branch when any
declared parameter changes.

Durable experiment work is kept on its branch. This project does not maintain
a parallel experiment-manifest registry or a common training abstraction.

Detection ran to the 40-epoch ceiling. Training and validation loss sums fell
from 5.0105 to 3.1257 and 5.9297 to 3.3774. Best validation box mAP50 was
0.4284 at epoch 38, and best mAP50-95 was 0.1860 at epoch 35. The run learned,
but convergence was not established before the epoch ceiling. Segmentation
stopped at epoch 16 under the declared eight-epoch patience rule. Best mask
mAP50 and mAP50-95 were 0.2698 and 0.1248 at epoch 8, which supports a
validation plateau.

On the frozen test fold, Pathologize-native evaluation produced detection
localization F1 0.5207, segmentation localization F1 0.6112, and conditional
polygon mean IoU 0.7598. The transparent baseline values were 0.2636 and
0.5313 for localization F1 and conditional polygon mean IoU. Aggregate GPU
evidence was 1,875.5 seconds against the 86,400-second ceiling, and prediction
normalization rejected no instances. See
[the learned-baseline evidence report](reports/nucls-learned-baseline.md)
for curves, per-class and held-out-site slices, failures, resources, and pins.

Neither path makes a clinical-validity claim.
