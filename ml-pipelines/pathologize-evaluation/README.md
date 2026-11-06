# Pathologize evaluation

This project defines downstream benchmark contracts for computational pathology
without storing clinical slides or annotations. Its checked-in fixture plan
generates flat-color PPM images and PGM masks. They test file handling, split
isolation, metrics, scorecards, and the DVC graph. They are not tissue models,
do not resemble a clinical cohort, and cannot support a clinical claim.

The initial executable workstreams are:

- whole-slide tissue segmentation, artifact localization, artifact-free tissue,
  and a slide-level quality decision;
- tissue-aware tiling at a declared physical scale; and
- nucleus detection, instance segmentation, and two meaningless synthetic
  classes named `synthetic_type_a` and `synthetic_type_b`.

Slide encoders and downstream biomarker evaluation are valid later workstreams,
but this project does not select an encoder, biomarker, endpoint, or clinical
task. Any such experiment needs its own manifest, patient-level leakage review,
external-cohort plan, and task-specific metrics before code is added.

## Run it

Run all commands through mise:

```bash
mise run //ml-pipelines/pathologize-evaluation:check
mise run //ml-pipelines/pathologize-evaluation:repro
mise run //ml-pipelines/pathologize-evaluation:dvc -- dag
```

The check installs the locked Python environment, runs Ruff and ty, executes the
coverage suite, checks generated JSON Schemas for drift, reproduces the DVC DAG,
and verifies scorecard hashes and gates. It uses no network model, paid API, GPU,
or private pathology data.

## Benchmark contracts

Each file under `experiments/` validates against
`schemas/experiment-manifest.schema.json` and pins:

- one workstream and a non-clinical purpose;
- a synthetic fixture manifest or external Pathologize registry revision;
- the evaluation split and leakage units;
- a baseline adapter plus an optional candidate adapter;
- metric direction, role, units, thresholds, and allowed regression;
- byte, pixel, accelerator-time, and paid-API budgets; and
- a disabled super-resolution evaluation seam.

Candidate scorecards compare primary-metric deltas and guardrail regressions
against the pinned baseline. The checked-in experiments have no candidate, so
their recommendation is `baseline_only`. This is intentional. The synthetic
run proves the contract, not that a useful model has been found.

Adapters implement the public `ModelAdapter` protocol in
`src/pathologize_evaluation/adapters.py`. A Python entrypoint adapter must pin a
version and artifact SHA-256. The initial `deterministic-color-v1` adapter uses
exact fixture colors and reports zero accelerator seconds and zero paid API
calls. It is not a foundation model baseline.

## Leakage boundary

Every split policy must include these disjoint units:

- `subject_id`;
- `specimen_id`;
- `block_id`; and
- `slide_id`.

The initial experiments also isolate `acquisition_id`. `site_id` is available
for site-held-out studies but is not mandatory for every experiment. Validation
fails if a configured leakage key appears in more than one split. Registry IDs
are opaque strings. This project neither derives nor reverses them.

## Objective metrics

The whole-slide scorecard reports tissue IoU, macro F1 over the two synthetic
artifact labels, Dice over artifact-free tissue, and slide rejection accuracy.
The tiling scorecard reports selected-tile F1, tissue coverage, background
fraction, and relative error in target microns per pixel. The nucleus scorecard
reports detection F1, semantic Dice, mean matched-instance IoU, and macro class
F1. Binary panoptic quality is diagnostic only. It cannot decide promotion on
its own.

That last choice is deliberate. The original panoptic-quality definition uses
IoU greater than 0.5 for unique instance matching, but published pathology work
has shown that PQ can hide important nucleus detection and classification
failure modes. The benchmark therefore keeps detection, segmentation, and
classification measures separate.

The methods and metadata names come from public sources:

- [HistoQC](https://pmc.ncbi.nlm.nih.gov/articles/PMC6552675/) describes
  tissue-limited artifact masks and slide-level quality measurements.
- [OpenSlide's public properties](https://openslide.org/docs/properties/)
  define `openslide.mpp-x` and `openslide.mpp-y` and warn that objective power
  can be missing or inaccurate. The tiling contract uses microns per pixel.
- [Panoptic Segmentation](https://openaccess.thecvf.com/content_CVPR_2019/html/Kirillov_Panoptic_Segmentation_CVPR_2019_paper.html)
  defines PQ and its matching rule.
- [A pathology-specific analysis of PQ](https://pmc.ncbi.nlm.nih.gov/articles/PMC10224986/)
  explains why it should not be the sole nucleus benchmark.

## Resource accounting

Every run writes `resources.json` with sample count, input bytes, prediction
bytes, pixels read, accelerator seconds, and paid API calls. Optional observed
wall time, CPU time, and peak RSS fields are part of the schema, but the
reproducible DVC run leaves them null because machine timings would change the
content hash on every run. A production runner may populate them in a separate
execution record.

The scorecard applies the manifest's deterministic resource limits. A candidate
cannot be promoted when any metric or resource gate fails.

## External Pathologize registry

`schemas/pathologize-registry-export.schema.json` is the import boundary. An
external export contains opaque item IDs, split and leakage keys, physical
scale, checksummed image references, and checksummed annotation references.
An experiment using `kind: pathologize_registry` must pin all of the following:

- contract `pathologize.data-registry-export/v1`;
- a 40-character Git revision;
- the registry URI;
- the export manifest path and SHA-256; and
- `copy_raw_data: false`.

`pathologize-evaluation import-registry <experiment-id>` validates the digest
and revision, then writes a normalized reference index. It does not fetch or
copy image bytes. No registry export is checked in because the future registry
revision does not yet exist. This avoids inventing clinical records or silently
coupling the benchmark to an unstable registry schema.

## DVC graph and outputs

The DAG generates fixtures, validates contracts, runs adapters, evaluates each
workstream independently, then aggregates the three scorecards. DVC tracks the
generated directories by content hash; Git keeps only the graph and lockfile.

Machine-readable outputs are:

- `outputs/contracts/validation.json`;
- `outputs/runs/<experiment>/<adapter>/predictions.jsonl` and `resources.json`;
- `outputs/scorecards/<experiment>.json`;
- `outputs/scorecard/benchmark.json`; and
- `outputs/scorecard/metrics.json`, exposed as DVC metrics.

Scorecard and aggregate IDs hash canonical JSON bodies. `verify` recalculates
both hashes, validates schemas, reruns leakage checks, rejects failed gates, and
requires all initial evidence to remain marked synthetic and non-clinical.

## Super-resolution boundary

Super-resolution is not implemented. Every manifest must keep the seam disabled,
preserve source pixels, forbid claims about invented detail, and require a
separate native-resolution scorecard before a future evaluation could be
designed. Enabling the current field fails schema validation.

## Limits

The synthetic baseline is expected to score near perfectly because fixture
colors encode the answer. Those values test arithmetic and wiring only. The
project contains no clinical cohort, no reader study, no calibration evidence,
no external validation, no selected foundation model, and no clinical-validity
claim. A real scorecard begins only after an approved, pinned registry export is
available and its rights, provenance, label protocol, and split policy have been
reviewed outside this repository.
