# AIRAQc TCGA public-pilot data product

This project owns the fixed 24-slide AIRAQc TCGA public-pilot product in the
source vocabulary. It publishes patient and slide identities, scanner
metadata, physical scale, four native annotation classes, source URLs, byte
counts, and checksums. It preserves the publisher test role.

The 48-asset manifest covers 24 GDC whole-slide images and their AIRAQc
annotation masks, totalling 15,813,730,059 bytes. The paper is CC BY 4.0. The
linked annotation folder has no standalone licence file, so this repository
does not redistribute slide or annotation bytes.

## Reproduce the contract

```bash
mise //data-products/airaqc/tcga-public-pilot:repro
mise //data-products/airaqc/tcga-public-pilot:check
```

Normal reproduction validates the pinned contracts and publishes
`outputs/native-corpus.json`. It does not download the raw assets.

## Acquire source bytes

Raw acquisition is explicit because the product is 15.8 GB:

```bash
mise //data-products/airaqc/tcga-public-pilot:acquire
```

The acquisition command accepts only the HTTPS prefixes declared by the
collection contract. It verifies every byte count and SHA-256 digest before
installing an asset under `data/raw/airaqc-tcga/public-pilot-v1`.

Downstream products must retain AIRAQc slide and patient identities. Ontology
mapping, repartitioning, exclusions, and label reinterpretation belong to the
consumer that publishes those decisions.
