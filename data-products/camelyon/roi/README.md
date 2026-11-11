# CAMELYON whole-slide ROI source data

This DVC product is the single owner of the third-party CAMELYON ROI source in
this repository. It covers all 399 CAMELYON16 whole-slide records and the 50
CAMELYON17 training slides with compatible publisher XML lesion annotations.
It preserves challenge roles, native labels and XML groups, annotation
completeness, patient, centre and lymph-node identities where the publisher
provides them, level-0 coordinates, physical-scale references, rights, and
checksums.

CAMELYON16 does not publish patient, node or per-slide centre assignments. Its
records keep those fields null and say why. CAMELYON17 names patients, centre
IDs and nodes in its archive layout, so those identities remain intact.

The publisher says that additional cytokeratin IHC slides supported revision
of the lesion annotations. The distributed input slides are H&E. This product
does not claim, reference or acquire IHC image artifacts.

## Metadata-only reproduction

Normal reproduction validates the committed source contract and publishes
stable record and artifact references. It does not download the roughly 3 TB
image corpus.

```bash
mise //data-products/camelyon/roi:repro
mise //data-products/camelyon/roi:check
```

The upstream metadata check downloads only six official README, checksum and
label files, then verifies their pinned SHA-256 digests:

```bash
mise //data-products/camelyon/roi:verify-metadata
```

## XML annotation acquisition

The three official annotation archives total about 11 MB. This explicit task
checks publisher MD5 values and pinned SHA-256 values, safely extracts XML, and
indexes every polygon with its original group and ordered level-0 coordinates:

```bash
mise //data-products/camelyon/roi:acquire-annotations
```

Raw archives, extracted XML and the coordinate index stay under `data/`, which
Git ignores. Downstream products should consume `outputs/native-records.jsonl`
and `outputs/artifact-references.json`. They must not copy slide bytes or add
Pathologize cohort decisions to this source product.

Individual WSI artifacts or CAMELYON17 patient archives can also be acquired
by stable artifact ID. The caller must set a byte budget at least as large as
the pinned artifact:

```bash
mise //data-products/camelyon/roi:acquire -- \
  --artifact_id=camelyon16-normal_001-wsi --max_bytes=2147483648
```
