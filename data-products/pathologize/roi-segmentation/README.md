# Pathologize ROI-segmentation data

This derived DVC product defines the Pathologize interface for slide-coordinate
regions of interest. It accepts source-native region records from more than one
organ and preserves the publisher's slide identity, group identity, geometry,
coordinate frame, pyramid level, physical scale, stain provenance, source role,
and optional molecular-status links.

Dataset adapters assign one of three Pathologize ROI-selection roles. They do
not turn regions into tissue compartments or artifact-quality labels. Each
output record keeps the source label beside the derived role and states whether
the mapping is exact, partial, source-merged, unmapped, or dropped.

## Current source boundary

The CAMELYON and PAIP 2019 source products are owned by separate Work Graph
tickets. Until those products publish their source interfaces, `imports.json`
binds this product to small synthetic contract fixtures. The fixtures contain
no publisher bytes and make no claim about source checksums, access, rights, or
redistribution. Those facts belong to the source products. Replacing a fixture
binding with a source interface must also add the source manifest and DVC lock
as stage dependencies.

The CAMELYON-shaped fixture covers lymph-node metastasis regions. The
PAIP-shaped fixture covers liver whole-tumour and viable-tumour regions. Both
use invented identifiers and coordinates. IHC provenance, non-zero pyramid
levels, anisotropic physical scale, and linked molecular status are contract
features tested with constructed records, not claims about either fixture.

The product publishes a JSONL records table, a product manifest, partitions,
lineage, reconciliation evidence, and metrics. Source image and annotation
artifacts remain references with source-product IDs, stable URIs, and SHA-256
digests when the source provides them. The product manifest declares no binary
outputs because this slice creates no masks, tiles, embeddings, registrations,
or transformed images.

## Roles and leakage

Publisher test roles remain test data. Development records are assigned to
train or validation by a seeded SHA-256 hash of the source dataset and source
group. Every ROI from one source group and every ROI from one slide therefore
stays in one product partition.

Build and verify the product with:

```bash
mise //data-products/pathologize/roi-segmentation:repro
mise //data-products/pathologize/roi-segmentation:check
```
