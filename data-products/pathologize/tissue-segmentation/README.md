# Pathologize tissue segmentation

This derived DVC project defines the Pathologize contract for composing general
semantic tissue and cell-compartment segmentation sources. It is not an image
collection. Records point to source-owned image and mask artifacts by path and
SHA-256 digest. The project does not copy source bytes.

The first portfolio has three pending source products:

- BCSS, an exhaustive multiclass breast H&E ROI source with explicit ignore
  pixels.
- SegPath, a multi-organ H&E source with one positive cell-type mask per record.
  Registered IF restaining supplies the annotation evidence.
- The colorectal H&E, IHC, and CISH epithelium corpus. Its binary masks identify
  epithelium while normal mucosa and cancer remain source tissue roles.

Each source keeps its native labels, roles, rights, retrieval evidence,
checksums, and physical metadata. This product owns the Pathologize ontology,
adapters, group-safe partitions, assay-aware lineage, and reconciliation
reports. Adapter statuses distinguish exact, partial, source-merged, unmapped,
and dropped concepts. Artifact quality, ROI selection, nucleus analysis, and
instance segmentation are outside this product.

## Contract fixture boundary

The three source projects are being implemented on separate tickets. Until
their DVC locks, manifests, and native indexes land, this project builds only a
small synthetic contract fixture. `imports.json` records the expected pinned
interfaces and required source evidence. Generated reports set
`production_ready` to false and name every pending import.

The fixture verifies table shape, mappings, partitions, stable artifact
references, H&E and IHC image provenance, IF-derived annotation provenance,
and lineage. It contains no dataset bytes and is not training or evaluation
data. Source access, redistribution rights, archive checksums, and retrieval
limitations remain the responsibility of each source product. This fixture
cannot verify them.

If this product later creates a mask, tile, embedding, registration, or
transformed image, it must add that binary output to lineage with the operation
and every parent artifact. The current product creates none, so lineage reports
empty `owned_binary_outputs` and `binary_transformations` arrays.

Run the deterministic checks and reproduce the DVC stage with:

```bash
mise //data-products/pathologize/tissue-segmentation:check
mise //data-products/pathologize/tissue-segmentation:repro
```
