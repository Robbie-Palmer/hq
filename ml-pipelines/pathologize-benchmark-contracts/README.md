# Pathologize benchmark contracts

This Python package holds pathology-specific types, fixtures, metrics, and the
deterministic runner shared by the Pathologize benchmark projects. Generic
artifact handling and schema writing come from `packages/data-artifacts`.
Adapter contracts, resource accounting, and gates come from
`packages/ml-evaluation`. This package is not an evaluation
project, dataset, data registry, or clinical product.

The executable projects are:

- `pathologize-slide-quality-benchmark` for tissue segmentation, artifact
  localization, artifact-free tissue, and slide rejection;
- `pathologize-tiling-benchmark` for tissue-aware tile selection and physical
  scale policy; and
- `pathologize-cell-analysis-benchmark` for nucleus detection, instance
  segmentation, and synthetic cell classification.

Slide encoders and downstream biomarker tasks need separate benchmark projects
once a concrete data contract and endpoint exist. This package does not select
an encoder, foundation model, biomarker, endpoint, or clinical task.

## Contracts

The generated JSON Schemas define:

- a benchmark project with one workstream and one or more experiment paths;
- typed experiment manifests;
- deterministic fixture manifests;
- the future Pathologize registry export boundary;
- per-experiment scorecards; and
- aggregate scorecards.

Every experiment pins its source, evaluation split, split-isolation identity fields, adapters,
metric direction and gates, resource limits, and disabled super-resolution
seam. Candidate adapters must pin a version, module path, artifact SHA-256, and
execution device. The loader resolves the module path and verifies its digest
before importing the module. The checked-in
baseline reads fixture colors and makes no network, model, or GPU call. It tests
the contracts and metric arithmetic. It is not a model choice.

Run the package checks through mise:

```bash
mise run //ml-pipelines/pathologize-benchmark-contracts:check
```

## Split isolation and registry boundary

The schema calls these identity fields `leakage_units`. Each listed identity
must occur in only one of the train, validation, or test splits. This prevents
related samples from crossing a split boundary and inflating evaluation
results. Every policy isolates `subject_id`, `specimen_id`, `block_id`, and
`slide_id`. The current projects also isolate `acquisition_id`, `site_id`, and
`scanner_id`. Registry IDs remain opaque strings.

An external registry experiment must pin contract
`pathologize.data-registry-export/v1`, a 40-character Git revision, registry
URI, export path, and export SHA-256. `copy_raw_data` must be `false`. The
importer validates those references and writes an index. It does not fetch or
copy image bytes.

The export is the [MLCommons Croissant
1.1](https://docs.mlcommons.org/croissant/docs/croissant-spec-1.1.html)
document, not a Pathologize envelope around one. The registry producer adds
the contract ID and Git revision through the Pathologize JSON-LD namespace and
validates the generated document with `mlcroissant` before publication.

The source export contains collection provenance, licences, retrieval
evidence, checksums, stable source identities, scanner metadata, physical
scale, and source-native labels. It contains no split assignment, derived
representation, or task annotation. Those fields belong to the downstream
project that makes them.

The importer checks the pinned export SHA-256, contract ID, and registry Git
revision, then writes a local index of the source reference. It does not copy
image bytes. The built-in runner does not consume registry data. A future
downstream selection contract must join selected Croissant records to project
owned split assignments and validate split isolation before evaluation.

## Resource and cost boundary

Experiment manifests bound input bytes, prediction bytes, input pixels, wall
time, CPU time, peak resident memory, accelerator wall time, and peak accelerator
memory. Scorecards record every value. Accelerator adapters are supported and
receive time and memory gates. The local runner uses NVIDIA NVML for
process-level memory enforcement. Kubernetes GPU utilization, power, health,
and workload telemetry belong to the cluster's DCGM and OpenTelemetry stack.
Provider authorization and monetary cost are outside this benchmark contract.

If a future adapter uses metered provider inference, its run telemetry must use
the platform's shared `Money` and `ResourceQuantity` semantics. Funding policy
belongs to orchestration, while the scorecard records observed cost. Until a
language-neutral shared contract exists, Pathologize does not publish monetary
fields.

## Fixture formats

The deterministic fixtures use Netpbm files because the parser needs no imaging
library. PPM means Portable Pixmap and stores RGB pixels. PGM
means Portable Graymap and stores one integer channel, which the fixtures use
for masks and instance IDs. These plain-text images are geometric contract
fixtures. They do not resemble tissue or represent a patient cohort.

## Method limits

The public method references are:

- [HistoQC](https://pmc.ncbi.nlm.nih.gov/articles/PMC6552675/) for tissue-limited
  artifact masks and slide-level quality measurements;
- [OpenSlide properties](https://openslide.org/docs/properties/) for microns per
  pixel metadata and the limits of objective-power metadata;
- [Panoptic Segmentation](https://openaccess.thecvf.com/content_CVPR_2019/html/Kirillov_Panoptic_Segmentation_CVPR_2019_paper.html)
  for panoptic quality and matching; and
- [a pathology-specific analysis of panoptic quality](https://pmc.ncbi.nlm.nih.gov/articles/PMC10224986/)
  for the decision to report detection, segmentation, and classification
  separately.

The package makes no clinical-validity claim. Super-resolution remains a
disabled, safety-bounded contract field. The package implements no image
enhancement.
