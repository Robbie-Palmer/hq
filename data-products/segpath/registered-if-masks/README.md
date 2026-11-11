# SegPath registered IF-derived mask source data

This DVC source product is the single owner of the publisher-native
[SegPath](https://dakomura.github.io/SegPath/) distribution. It keeps the eight
antigen tasks separate and preserves each H&E image, registered IF-derived mask,
TMA slide ID, published tumour type, WSI coordinates, physical scale, and
train/validation/test role.

The masks are not ordinary manual H&E annotations. The
[publisher's paper](https://doi.org/10.1016/j.patter.2023.100688) describes how
the same H&E sections were destained, restained with target-specific
immunofluorescence and DAPI, and registered at WSI and patch level. Five tasks
transfer positive IF signal to DAPI-detected nuclei. The released archives
contain the H&E images and derived binary masks, not the intermediate IF or DAPI
images. `manifest.json` records that boundary instead of inventing unavailable
artifacts.

## Source contract

`manifest.json` pins the eight official Zenodo records, archive and metadata
sizes, publisher MD5 checksums, the paper's Table S2 checksum, and the
CC-BY-NC-SA-4.0 terms. The full H&E and mask archives total 305,525,589,629
bytes. They remain ignored by Git.

The DVC graph downloads only the 22.4 MB publisher CSV metadata and Table S2.
It writes one `outputs/native-records.jsonl` row per published H&E/mask pair.
Each row exposes stable `segpath://` artifact references, native archive member
paths, the antigen task, source slide and tumour type, source coordinates,
published role, and registration relation between the mask and H&E input.

Run the deterministic contract check without downloading any publisher file:

```bash
mise //data-products/segpath/registered-if-masks:verify
mise //data-products/segpath/registered-if-masks:check
```

Reproduce the metadata-backed native record index with:

```bash
mise //data-products/segpath/registered-if-masks:repro
```

Full artifact retrieval is intentionally separate because it requires about
305.5 GB plus extraction space:

```bash
mise //data-products/segpath/registered-if-masks:acquire:artifacts
```

## Downstream use

Downstream products should pin this project's `dvc.lock`, `manifest.json`, and
`outputs/native-records.jsonl`, then retain `record_id`, `source_slide_key`, and
the `segpath://` references. They must not copy SegPath images or masks. Tissue
cohorts, stain groupings, target ontologies, split changes, or other
Pathologize semantics belong in a downstream adapter and product.

The source table calls its identity field `tumour type`; this product keeps that
wording as `published_tumour_type`. It does not derive a normalized organ field.
