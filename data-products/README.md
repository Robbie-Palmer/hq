# Data products

Each project in this directory is a vertical data product owned by one bounded
context. The project keeps its contracts, acquisition or transformation code,
DVC graph, quality checks, and published artifacts together.

Source products use the publisher's ubiquitous language. They preserve source
identities, native labels, rights, checksums, physical metadata, and declared
roles. Derived products pin upstream interfaces and own their adapters, target
ontologies, exclusions, annotations, and partitions. Every derived record
retains source lineage.

Current products:

- `grandqc/mpp20`: source-native GrandQC MPP20 patch pairs and masks.
- `nucls/corrected-single-rater`: source-native NuCLS fields of view,
  annotations, ontology, and official fold roles.
- `airaqc/tcga-public-pilot`: source-native AIRAQc annotations and referenced
  TCGA slides for the fixed 24-slide pilot.
- `pathologize/slide-quality`: the reconciled Pathologize artifact-spatial
  product built from GrandQC and AIRAQc.
- `pathologize/nucleus-analysis`: the source-preserving NuCLS task product
  with frozen patient- and slide-disjoint roles.
- `pathologize/stain-assay-provenance`: metadata-only contracts for stain,
  assay, pairing, source artifact references, derived artifact lineage, and
  annotation provenance.

Projects under `ml-pipelines/` consume these products for training and
evaluation. Shared packages and orchestration do not own product semantics.
