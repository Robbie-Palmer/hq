# Pathologize benchmark contracts

This Python package holds pathology-specific types, fixtures, metrics, and the
deterministic runner shared by the Pathologize benchmark projects. Generic
artifact handling, adapter contracts, resource accounting, gates, and schema
writing come from `packages/ml-evaluation`. This package is not an evaluation
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

Every experiment pins its source, evaluation split, leakage units, adapters,
metric direction and gates, resource limits, and disabled super-resolution
seam. Candidate adapters must pin a version and artifact SHA-256. The checked-in
baseline reads fixture colors and makes no network, model, or GPU call. It tests
the contracts and metric arithmetic. It is not a model choice.

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

The registry export references public standards at their actual lifecycle
positions:

| Boundary | Contract |
| --- | --- |
| Dataset structure and distributions | [MLCommons Croissant 1.1](https://docs.mlcommons.org/croissant/docs/croissant-spec-1.1.html) metadata, referenced by URI and SHA-256 |
| Source or interchange slide representation | [DICOM VL Whole Slide Microscopy Image IOD](https://dicom.nema.org/medical/dicom/2026c/output/chtml/part03/sect_A.32.8.html), or an explicitly non-standard vendor-native source |
| Derived compute representation | [OME-NGFF 0.6](https://ngff.openmicroscopy.org/specifications/0.6/) with a required link to its source representation |
| Research-object packaging | [RO-Crate 1.3](https://www.researchobject.org/ro-crate/specification/1.3/) metadata, referenced by URI and SHA-256 |
| Transformation provenance | [W3C PROV-O](https://www.w3.org/TR/prov-o/) graph, referenced by URI and SHA-256 |

Pathologize validates its references and lifecycle invariants. It does not
claim to validate the external Croissant, DICOM, OME-NGFF, RO-Crate, or PROV-O
documents themselves. A registry producer must run the validators owned by
those formats before publishing an export.

DICOM and vendor-native objects remain source or interchange representations.
OME-Zarr is a derived, compute-oriented representation for chunked analysis,
labels, and multiresolution access. The export cannot describe OME-Zarr as a
source, and every OME-Zarr representation names the representation it derives
from.

## Resource and cost boundary

Experiment manifests bound bytes, pixels, and accelerator time. Scorecards
record those measurements plus optional wall time, CPU time, and peak resident
memory. Provider authorization and monetary cost are outside this benchmark
contract.

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
