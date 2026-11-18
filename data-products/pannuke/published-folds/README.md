# PanNuke published-fold source data

This DVC source product owns the three PanNuke fold archives published by the
University of Warwick Tissue Image Analytics Centre. It keeps the source fold
numbers, tissue strings, image-array positions, six-channel instance masks,
cell-class channel meanings, and all three published fold-to-role arrangements.
It does not choose one arrangement as canonical and does not translate PanNuke
classes into a Pathologize ontology.

## Source contract

`manifest.json` pins the Warwick URLs, HTTP metadata, archive sizes, SHA-1 and
SHA-256 digests, the 2020 source version, rights evidence, 19 tissue strings,
and five nucleus-class channels plus background. Warwick does not publish a
checksum manifest. The SHA-256 values in this repository were computed from
the Warwick archives on 2026-11-11. Warwick serves each matching SHA-1 value as
its HTTP ETag.

The publisher archives contain no sample identifier, patient identifier, slide
identifier, or group identifier. The index therefore records the original
fold and zero-based array position, then derives a repository key such as
`pannuke:fold-1:000000` from those two source coordinates. Consumers must not
treat that key as a publisher, patient, or slide identity.

Each mask array has six channels. Channels 0 through 4 contain source instance
labels for Neoplastic cells, Inflammatory, Connective/Soft tissue cells, Dead
Cells, and Epithelial. Channel 5 is background. The bundled publisher README
calls the last entry "6: Background" despite the array having indices 0 through
5. The manifest records both facts instead of silently correcting the source
documentation.

## Verification and reproduction

Check publisher headers without downloading the 2.08 GB distribution:

```bash
mise //data-products/pannuke/published-folds:verify-metadata
```

Acquire, verify, and index the archives with:

```bash
mise //data-products/pannuke/published-folds:repro
mise //data-products/pannuke/published-folds:check
```

The index reads NumPy headers and the small tissue arrays directly from each
ZIP. It does not expand the roughly 37 GB of image and mask arrays. Records
retain an archive member and array index for both source arrays. Dataset bytes
remain ignored by Git and owned by DVC.

PanNuke is licensed under CC BY-NC-SA 4.0 for non-commercial research use.
Redistribution and adaptations must follow the attribution, non-commercial,
and share-alike terms on the publisher page. This repository commits only the
contract, code, DVC metadata, and tests, not the archives or extracted arrays.

## Downstream use

Downstream products must pin this project's `dvc.lock`, `manifest.json`, and
`outputs/native-index.jsonl`. Any class mapping, fold-to-role assignment,
arrangement selection, exclusion, reannotation, or leakage grouping belongs in
a separate derived product.
