# Pathologize ROI-segmentation data

This derived DVC product adapts source-native slide-coordinate regions into the
Pathologize ROI-selection contract. It preserves source identities, labels,
geometry, scale, stain provenance, roles, and linked molecular status. Dataset
adapters keep ROI selection separate from tissue compartments and artifact
quality.

The product publishes records, mappings, partitions, lineage, reconciliation
evidence, and metrics. It references source-owned image and annotation
artifacts instead of copying them.

Build and verify the product with:

```bash
mise //data-products/pathologize/roi-segmentation:repro
mise //data-products/pathologize/roi-segmentation:check
```
