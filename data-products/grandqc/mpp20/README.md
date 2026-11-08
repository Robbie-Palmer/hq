# GrandQC source data

This reusable DVC source project owns the source-native GrandQC MPP20
distribution from Zenodo
record `14039591`. It preserves the publisher's directory layout, test-dataset
role, organ names, WSI-derived group IDs, and mask values 0 through 7.

It does not map GrandQC labels into a consumer ontology or assign train,
validation, or evaluation roles. Those decisions belong to downstream data
products.

## Data contract

`manifest.json` pins the DOI, rights statement, archive size, MD5, SHA-256,
native labels, declared WSI count, and expected image-mask pair count. The
source bytes remain ignored by Git and owned by DVC.

The `index_mpp20` stage extracts the archive without accepting links or path
traversal. It writes one JSONL record per source patch pair. Each record keeps
the organ, source group, source image and mask paths, MPP, dimensions, native
labels present, and native pixel counts.

## Reproduce

```bash
mise //data-products/grandqc/mpp20:repro
mise //data-products/grandqc/mpp20:check
```

The archive is 928,040,960 bytes. Its depositor limits use to non-commercial
academic research. Do not publish or redistribute its image or mask bytes from
this repository.

## Downstream use

Downstream DVC projects depend on this project's `dvc.lock`, `manifest.json`,
and `outputs/native-index.jsonl`. They must retain the source record and group
IDs. Any ontology mapping or change from the publisher's test role must be a
versioned downstream artifact.
