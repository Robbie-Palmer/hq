# Pathologize nucleus-analysis data

This derived DVC product adapts the source-native corrected single-rater NuCLS
product into a stable Pathologize nucleus-analysis interface. It preserves the
public five-label ontology and coordinate semantics, then assigns the frozen
patient- and slide-disjoint roles used by the public baseline.

The product owns the adapter, target ontology, role policy, lineage,
partitions, reconciliation evidence, and metrics. It references source-owned
RGB and annotation bytes instead of copying them. ML pipelines consume the
published records and do not rebuild folds or ontology mappings.

```bash
mise //data-products/pathologize/nucleus-analysis:repro
mise //data-products/pathologize/nucleus-analysis:check
```
