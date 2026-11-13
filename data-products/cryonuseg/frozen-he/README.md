# CryoNuSeg frozen H&E source data

This DVC product records the 30 CryoNuSeg frozen-section H&E patches in the
publisher's vocabulary. It pins Kaggle version 7, the publisher repository,
the paper, every `Selected_WSIs.xlsx` row, three manual annotation releases,
the native ROI boundaries and mask families, and the current GDC Tissue Slide
that matches each historical publisher record.

The 30 patches cover ten organs, with three different TCGA patients and tissue
source sites per organ. Each patch remains linked to its source WSI. The
product does not copy or reclassify that WSI.

## Reproduce the metadata product

```bash
mise //data-products/cryonuseg/frozen-he:repro
mise //data-products/cryonuseg/frozen-he:check
```

Normal reproduction is metadata-only. It validates the checked-in source
contract and publishes `outputs/native-corpus.json`. It does not download the
172,522,035-byte Kaggle bundle or any GDC slide.

Run the public metadata checks separately:

```bash
mise //data-products/cryonuseg/frozen-he:source-check
```

The source check reads Kaggle metadata, the pinned GitHub workbook, and GDC
file metadata. It downloads no dataset images. If a v7 bundle already exists
outside Git, verify its byte count and digest with:

```bash
mise //data-products/cryonuseg/frozen-he:verify-archive -- /path/to/archive.zip
```

Kaggle reports 416,431,626 bytes for the dataset contents. The compressed v7
bundle is 172,522,035 bytes with SHA-256
`8843b3524920e0e786c66c1aa73484ed1c1ee01a5c33c20045d2b1b250c547d8`.
The product records both values because they describe different byte streams.

## Scope and rights

CryoNuSeg contains frozen patches only. It has no paired FFPE images, clinical
outcomes, preparation timing, consensus annotation, or official training
partition. The repository and Kaggle release say MIT. That label does not
replace the terms that govern the upstream TCGA pixels.

This source can support studies of frozen-section nuclear artifacts,
annotation variability, and nuclei instance segmentation. Cross-source
harmonization, FFPE comparison, training cohorts, Pathologize labels, and
claims about diagnostic confidence, operations, or cost belong elsewhere.
