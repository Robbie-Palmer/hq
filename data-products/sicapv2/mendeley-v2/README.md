# SICAPv2 Mendeley version 2 source data

This DVC source product owns DOI `10.17632/9xxm58dvs3.2` in the publisher's
vocabulary. It pins the authoritative Mendeley version 2 record and the
`SICAPv2.zip` file. The archive identifies its internal release as
`Version 1: 2020-05`; both version identities remain in the manifest.

The native index preserves patient, slide, and patch identities. It also keeps
the filename coordinates, 10X scale, image-mask pairs, Gleason mask values,
global primary and secondary scores, grade groups, and every published
grading and cribriform train/test role. Grade groups are the lossless ISUP
group corresponding to the published primary and secondary score pair. No
Pathologize cohort or task split is added here.

Each patient, slide, patch, and archive member has a stable source reference.
Downstream MIL, segmentation, and classification products can pin the manifest,
`dvc.lock`, and JSONL indexes while resolving image and mask bytes from the
original Mendeley archive. They must not copy SICAPv2 data into a derived
product.

## Verification

The metadata check calls Mendeley's public endpoints without credentials. It
compares the DOI, version, rights, contributor, archive file ID, byte count,
and SHA-256 digest with `manifest.json`. It does not download the 2.16 GB
archive.

```bash
mise //data-products/sicapv2/mendeley-v2:metadata:verify
mise //data-products/sicapv2/mendeley-v2:check
```

Full reproduction downloads the pinned archive, verifies its SHA-256 digest,
and indexes it in place. The source bytes remain ignored by Git and owned by
DVC.

```bash
mise //data-products/sicapv2/mendeley-v2:repro
```

SICAPv2 is licensed under CC BY 4.0. Consumers must retain attribution, link
the license, and identify changes.
