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
- `panda/challenge-2020`: source-native PANDA prostate-biopsy slides, grades,
  provider-specific masks, rights, checksums, and gated access contract.
- `airaqc/tcga-public-pilot`: source-native AIRAQc annotations and referenced
  TCGA slides for the fixed 24-slide pilot.
- `ega/matched-ffpe-frozen-single-cell`: controlled EGA identities and
  publisher evidence for matched FFPE and frozen single-cell profiling.
- `paip2019/liver-roi`: source-native PAIP 2019 liver whole-slide images,
  tumour masks, XML regions, challenge roles, and gated access contract.
- `segpath/registered-if-masks`: source-native SegPath H&E patches and
  registered IF-derived binary masks across eight antigen tasks.
- `pathologize/slide-quality`: the reconciled Pathologize artifact-spatial
  product built from GrandQC and AIRAQc.
- `pathologize/nucleus-analysis`: the source-preserving NuCLS task product
  with frozen patient- and slide-disjoint roles.
- `pathologize/roi-segmentation`: the multi-source slide-coordinate ROI
  composition contract, adapters, group-safe roles, and reconciliation reports.

Projects under `ml-pipelines/` consume these products for training and
evaluation. Shared packages and orchestration do not own product semantics.
