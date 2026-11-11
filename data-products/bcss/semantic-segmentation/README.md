# BCSS semantic-segmentation source data

This DVC source product is the single owner of the Breast Cancer Semantic
Segmentation dataset in its publisher vocabulary. It pins BCSS Figshare v2,
the publisher repository at commit
`3c49d554497dd896cd02ffe382503ef4ce28b1c1`, the 151 TCGA patient and slide
identities, WSI-base ROI coordinates, scan magnification, the 0.25 microns per
pixel publication scale, all 22 mask codes, and the original mask artifacts.

The native corpus exposes stable references for each ROI, Figshare mask,
Digital Slide Archive annotation endpoint, and TCGA WSI. GDC resolves 150 of
the 151 publisher WSI filenames in its 2026-11-11 release. The record for
`TCGA-A2-A0D2-01Z-00-DX1.ECD890F5-BA01-4998-B472-7B683BD6D7B1.svs`
retains the publisher filename and DSA item because GDC no longer returns that
diagnostic slide. It does not substitute another slide from the same patient.

BCSS labels code 0 as `outside_roi` and directs users to give those pixels zero
training weight. Code 7 remains the native `exclude` region. The product does
not merge either code into another class. The paper reports 82 core training
slides, 43 core testing slides, and 26 evaluation slides, but the repository
metadata does not publish record-level assignments. Each record therefore has
an empty `publisher_roles` list instead of a reconstructed split.

## Rights and acquisition

The publisher declares the dataset CC0 1.0 and the retrieval code MIT. The
referenced TCGA slides remain subject to the NCI Genomic Data Commons analysis
policy, including its prohibition on reidentification. Git tracks identifiers,
rights evidence, metadata, and checksums only. It does not track images, masks,
annotations, access tokens, or signed download URLs.

Normal reproduction is metadata-only:

```bash
mise //data-products/bcss/semantic-segmentation:repro
mise //data-products/bcss/semantic-segmentation:check
```

Acquire the 151 native masks explicitly when pixel inspection is required:

```bash
mise //data-products/bcss/semantic-segmentation:acquire:masks
```

The acquisition command accepts only the public Figshare file path and checks
the byte count, publisher MD5, and pinned SHA-256 before installing a mask.
H&E ROI pixels remain referenced by the publisher WSI identity, ROI bounds,
and extraction scale. Downstream products must use these references rather
than copying images.

This product does not define a Pathologize ontology, cohort, partition, or
adapter. Any label mapping, exclusion policy, grouping, or task role belongs
to a separate downstream product.
