# Pathologize slide-quality datasets

This product consumes the GrandQC MPP20 and AIRAQc TCGA public-pilot products.
It publishes a task-specific slide-quality dataset in the Pathologize bounded
context.

The source datasets keep their own language. This project owns the adapters,
target ontology, partitions, exclusions, lineage, and reports that reconcile
them.

## Current product

`pathologize.artifact-spatial-development/v1` has two roles:

- GrandQC patch pairs form train, validation, and internal-test partitions.
  The split groups every patch from the same source WSI together. This
  deliberately overrides GrandQC's publisher test-dataset role, so these
  results cannot be compared with the published GrandQC test result.
- The fixed AIRAQc pilot remains an external whole-slide evaluation set. It is
  never placed in the GrandQC development partitions.

The product is a manifest data product. Image and mask bytes stay in their
source DVC projects. Training code resolves each record through its source
project instead of copying source files into this project.

## Ontology adapters

The target ontology retains both fine and union concepts. GrandQC's merged
`dark spot and foreign object` and `edge and air bubble` labels remain union
concepts. The adapter does not pretend they can be split. AIRAQc's air-bubble
label remains the finer concept and can be promoted to the union parent when a
broad comparison needs it. Unlabelled AIRAQc pixels remain unknown.

Every harmonized record carries the source dataset, source record, source
group, source role, downstream role, native labels, mapping statuses, adapter,
and a source payload. `outputs/reconciliation.json` reports added records and
label coverage alongside merged concepts, unavailable distinctions, role
overrides, and dropped records.

## DVC project references

`imports.json` names the upstream DVC projects and artifacts. The DVC stage
also depends on each upstream `dvc.lock`. In this monorepo those are local
project dependencies, so `dvc status` detects a stale downstream product. If a
source registry moves to another Git repository, replace that local dependency
with a pinned `dvc import` and commit the generated import file.

Reproduce the source project, then this product:

```bash
mise //data-products/grandqc/mpp20:repro
mise //data-products/airaqc/tcga-public-pilot:repro
mise //data-products/pathologize/slide-quality:repro
mise //data-products/pathologize/slide-quality:check
```

The output partitions are suitable inputs to framework-native training code.
This project contains no classical image-processing or learned baseline.
