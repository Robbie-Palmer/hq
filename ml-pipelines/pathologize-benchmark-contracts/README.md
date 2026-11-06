# Pathologize benchmark contracts

This Python package holds the types and deterministic runner shared by the
Pathologize benchmark projects. It is not an evaluation project, dataset, data
registry, or clinical product.

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

Every experiment pins its source, evaluation split, leakage units, adapters,
metric direction and gates, resource limits, and disabled super-resolution
seam. Candidate adapters must pin a version and artifact SHA-256. The checked-in
baseline reads fixture colors and makes no network, model, GPU, or paid API
call. It tests the contracts and metric arithmetic. It is not a model choice.

Run the package checks through mise:

```bash
mise run //ml-pipelines/pathologize-benchmark-contracts:check
```

## Leakage and registry boundary

Every split policy isolates `subject_id`, `specimen_id`, `block_id`, and
`slide_id`. The current projects also isolate `acquisition_id`. Registry IDs
remain opaque strings.

An external registry experiment must pin contract
`pathologize.data-registry-export/v1`, a 40-character Git revision, registry
URI, export path, and export SHA-256. `copy_raw_data` must be `false`. The
importer validates those references and writes an index. It does not fetch or
copy image bytes.

## Fixture formats

The deterministic fixtures use Netpbm files because the parser is tiny and
needs no imaging library. PPM means Portable Pixmap and stores RGB pixels. PGM
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
disabled, safety-bounded contract field. No image enhancement is implemented.
