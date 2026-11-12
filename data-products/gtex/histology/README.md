# GTEx histology source data

This DVC project indexes GTEx histology and linked public preanalytic metadata
without committing slide bytes. It keeps four publisher namespaces separate:

- The GTEx Portal histology API has 25,713 metadata rows.
- AnVIL Data Explorer catalog `anvil15` has 25,708 original Aperio SVS files.
- Imaging Data Commons v25 has 25,503 DICOM slide series from 971 subjects,
  with 128,708 DICOM instances and a reported size of 8.555 TB.
- GTEx Analysis V8 has 22,951 public molecular sample-attribute rows and 980
  public subject rows.

The wider IDC collection description reports 26,468 tissue samples from 956
donors. Those figures describe the wider study. Each image inventory has its
own denominator.

## What the product preserves

GTEx divided each procured tissue into a histology block and a separate block
for molecular analysis. Both blocks used PAXgene Tissue Fixative for the
published 6 to 24 hour interval, then PAXgene Tissue Stabilizer. The histology
block was paraffin embedded, H&E stained, scanned with Aperio ScanScope, and
reviewed by one of four board-certified pathologists. Shared procurement does
not make the blocks the same section.

The indexes retain donor, tissue sample, histology image, molecular aliquot,
DICOM study, series, and instance identifiers. They also retain tissue type,
collection site, autolysis, total ischemic time, PAXgene fixative time,
pathology notes and categories, RIN, assay batches, age bracket, sex, Hardy
scale, file size, repository integrity fields, rights, access mode, and missing
values where the sources publish them.

The retired NCI Biospecimen Research Database viewer also published specimen
acceptability. On the 2026-11-11 snapshot date its old host redirected to the
replacement BRD, where the GTEx image viewer was no longer available. The
current GTEx, IDC, and AnVIL metadata do not expose acceptability. The product
records that absence instead of copying a stale or inferred value.

## Image access

AnVIL holds the original Aperio SVS corpus. GTEx describes it as about 8 TB.
The Terra workspace is requester pays, so transfer requires a Google Cloud
billing project and incurs any applicable egress charges. The acquired AnVIL
inventory contains a stable file ID, DRS URI, file size, and MD5 for every
indexed SVS. This project never downloads those SVS bytes.

IDC provides harmonized DICOM copies from public AWS and GCS buckets. Each
series record retains its public S3 prefix, size, CC BY 4.0 license, source DOI,
CRDC UUID, and DICOM identifiers. Each instance retains its SOP Instance UID,
CRDC instance UUID, and byte size. Zenodo record `11099100`, under concept DOI
`10.5281/zenodo.11099099`, pins the original IDC v19 AWS, GCS, and DRS
manifests with publisher checksums.

## Reconciliation boundary

`outputs/reconciliation.json` compares exact publisher identifiers. It does
not alter a DICOM container suffix to make a GTEx image ID, and it does not
assign one of the 25,713 GTEx API rows to one of the 25,503 IDC series without
a publisher crosswalk. The 210-row arithmetic difference therefore remains a
count difference, not 210 identified missing slides.

Exact GTEx subject IDs can link to IDC patient IDs. Exact GTEx histology image
IDs can link to AnVIL SVS filename stems. Exact molecular sample IDs supplied by
the histology API can link to V8 `SAMPID` values. Every other row stays
unmatched with the reason recorded.

## Run checks and acquisition

The default check is offline, metadata-only, and credential-free:

```bash
mise //data-products/gtex/histology:check
```

The live identity check makes small requests to official metadata endpoints.
It does not list a requester-pays bucket or download image bytes:

```bash
mise //data-products/gtex/histology:identity:check
```

Reproduction downloads public metadata, data dictionaries, and the three
small Zenodo manifests. It queries IDC and AnVIL metadata indexes, but it does
not download SVS or DICOM image bytes:

```bash
mise //data-products/gtex/histology:repro
```

The product supports source evidence for fixation, ischemia, autolysis,
histology artifact, assay-suitability, and later SOP studies. It is not a
direct FFPE-versus-frozen comparison or a diagnostic cancer cohort. Cohorts,
harmonization, exclusions, splits, derived outcomes, and cost models belong in
downstream products.
