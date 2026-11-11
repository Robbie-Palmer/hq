# CPTAC-LSCC source data

This DVC product records the public CPTAC-LSCC cohort in the terms used by its
official repositories. It keeps TCIA case, specimen, slide, and PathDB image
identifiers; PDC study, case, sample, aliquot, assay, and file identifiers; and
GDC case, sample, assay, file, release, and access-tier metadata.

The product links repositories only through evidence they publish. TCIA states
that its CPTAC subject ID is identical to the subject ID used by the related
clinical, proteomic, and genomic repositories. PDC biospecimen records also
publish TCIA collection and GDC case references. Specimen links require an exact
submitter-ID match. Missing links remain missing.

## Bounded release

- TCIA `CPTAC-LSCC` version 15: 212 participants and 1,081 public SVS whole-slide
  images, licensed CC BY 4.0.
- PDC LSCC studies `PDC000232`, `PDC000233`, `PDC000234`, and `PDC000237`, pinned
  by UUID and study version.
- GDC `CPTAC-3` records from Data Release 46.0, with each file's `open` or
  `controlled` access value retained.

The checked-in snapshots contain metadata only. They do not contain slide,
mass-spectrometry, genomic, clinical-document, or controlled-access payloads.
The artifact index records repository locators and published MD5 checksums.
TCIA does not expose per-slide checksums in its PathDB metadata export, so those
checksum fields remain absent with an explicit reason.

The artifact index records `H&E` from the PDC publisher's CPTAC pan-cancer
imaging statement and includes that evidence URL on each slide reference. TCIA's
PathDB CSV does not have a per-slide stain column, so consumers can distinguish
the cohort-level publisher statement from fields present in the native slide
record.

## Commands

```bash
mise //data-products/cptac/lscc-public:check
mise //data-products/cptac/lscc-public:repro
mise //data-products/cptac/lscc-public:verify:live
```

`refresh` is an explicit source-maintenance operation. It reads public metadata
from TCIA, PDC, and GDC and rewrites the pinned snapshots. Review release IDs,
rights, record-count changes, and snapshot diffs before committing a refresh.

## Primary sources

- [TCIA CPTAC-LSCC collection](https://www.cancerimagingarchive.net/collection/cptac-lscc/)
- [TCIA API and data-use policy](https://www.cancerimagingarchive.net/tcia-api-guides/)
- [PDC API documentation](https://proteomic.datacommons.cancer.gov/pdc/api-documentation)
- [PDC data licensing policy](https://pdc.cancer.gov/pdc-docs/usage)
- [GDC API documentation](https://docs.gdc.cancer.gov/API/Users_Guide/Getting_Started/)
- [GDC controlled-access policy](https://docs.gdc.cancer.gov/Encyclopedia/pages/Controlled_Access/)
- [GDC data-analysis policies](https://gdc.cancer.gov/analyze-data/data-analysis-policies)
