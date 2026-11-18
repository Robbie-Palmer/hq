# MoNuSAC 2020 source data

This DVC source product is the sole owner of the publisher's MoNuSAC 2020
challenge distribution in this repository. It pins the training, testing, and
supplemental artifacts. The source contract keeps publisher organs, TCGA image
and slide identities, instance-boundary XML, cell classes, annotation roles,
challenge split roles, rights, and archive evidence.

The product does not select a Pathologize cohort or translate MoNuSAC classes.
It contains no tissue, stain, genomic-status, or multisource adapter rules.
Those choices belong to a downstream product, which must reference these
records and archive members rather than copy source images.

## Stable source references

`outputs/native-index.jsonl` publishes one record per annotated source image.
Each record has a stable `record_ref`. Its image and annotation fields point to
an `artifact_ref` and the original ZIP member path. Both the `.svs` image and
the publisher's optional `.tif` copy remain visible. The typed XML loader
exposes every source annotation group, instance region, class, source metrics,
and polygon vertex without turning them into a downstream ontology.

MoNuSAC does not encode per-instance annotator identities. The paper says
engineering graduate students made the initial annotations and an expert
pathologist performed iterative quality control. The manifest records those
roles without inventing attribution for individual instances.

## Rights and checksum evidence

The challenge page licenses the data under CC BY-NC-SA 4.0. Redistribution
requires attribution, non-commercial use, and the same license. This repository
does not commit the dataset bytes. DVC owns the local downloads and generated
index.

The public Google Drive artifacts do not expose publisher-signed checksums on
the challenge page or in their download headers. `manifest.json` pins MD5 and
SHA-256 values computed from complete public responses on 2026-11-11. The
manifest says that plainly so a repository-observed digest is not mistaken for
publisher evidence.

The deterministic metadata path needs no dataset bytes:

```bash
mise //data-products/monusac/challenge-2020:verify:metadata
```

The optional public probe checks the current filenames, byte counts, and
Last-Modified response headers without downloading the response bodies:

```bash
mise //data-products/monusac/challenge-2020:verify:remote-metadata
```

That probe cannot recalculate the pinned hashes. Full checksum verification
requires acquiring the complete artifacts.

## Reproduce

```bash
mise //data-products/monusac/challenge-2020:repro
mise //data-products/monusac/challenge-2020:check
```

The source index preserves an inconsistency instead of hiding it. The
publisher's Table S1 assigns `TCGA-A2-A0ES` and `TCGA-MP-A4T7` to both split
roles, even though the paper describes non-overlapping patients. Source metrics
report the overlap. Any exclusion or role override must be explicit in a
downstream product.
