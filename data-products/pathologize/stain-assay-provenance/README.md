# Pathologize stain and assay provenance

This metadata-only project defines the Pathologize contract for stains, assays,
image pairing, artifact lineage, and annotation provenance. It follows PDR 009:
source products keep publisher vocabulary and downstream products add
Pathologize interpretations without changing the source record.

## Ownership boundary

One source product represents one third-party dataset. A source product owns
its acquired bytes, source records, rights, and stable artifact references. A
derived product imports those references and composes records as tables. It
does not copy a source image, annotation, or mask.

A derived product may own an annotation, mask, tile, embedding, registration,
or transformed image that it created. Each owned artifact records a SHA-256
digest, operation name and version, operation parameters, and parent artifact
IDs. The contract rejects unknown parents, ownership by another product, and
cycles in derived lineage.

`examples/contract-coverage.json` is synthetic. Its `example.invalid` links and
small declared byte counts exist only to exercise validation. The fixture
contains no pathology data. It covers H&E, IHC, IF, CISH, virtual stain output,
same-section restaining,
serial sections, registration, independent specimens, and manual,
assay-derived, and model-derived annotations.

## Source and downstream semantics

`SourceRecord.native_fields` is an opaque copy of publisher fields. A
Pathologize image record separately describes tissue preparation, assay,
scanner evidence, and physical scale. Missing scanner or scale facts stay
explicitly not reported. The model does not infer scale from objective power.

Assays use distinct types:

- H&E records hematoxylin and eosin reagents.
- IHC records markers, antibodies, chromogens, and counterstains.
- IF records target and fluorophore information per channel.
- CISH records probes, targets, chromogens, and counterstains.
- A virtual stain records its target assay, source images, model version, and
  weights digest. Its image must be an owned transformed artifact.

A registration is separate from the tissue relationship. A registered serial
pair therefore has both a `serial_sections` relation and a `registered_pair`
relation. The registration relation points to an owned registration artifact
with the transform parameters and both source images as parents.

## Existing product maps

The files under `migrations/` are bounded mapping examples. They do not rewrite
the nucleus-analysis or slide-quality products and do not claim that missing
metadata exists. Source image and annotation paths map to reference-only
artifacts owned by their source products.

The NuCLS map cites the primary paper for the H&E, FFPE, annotation, and CC0
facts, and cites the publisher's GigaDB record for the corrected single-rater
release:

- [NuCLS primary paper](https://doi.org/10.1093/gigascience/giac037)
- [NuCLS GigaDB record](https://gigadb.org/dataset/102207)

The slide-quality map uses the depositors' records and policies already pinned
by its source products:

- [GrandQC MPP20 Zenodo record](https://zenodo.org/records/14039591) states the
  file contents, scale, checksums, expert mask classes, and non-commercial
  academic terms.
- [AIRAQc primary paper](https://openreview.net/pdf?id=XNNsQqs1UP) describes the
  50 H&E TCGA slides, manual artifact annotations, and linked release. The
  paper's licence does not create broader rights for separately released files.
- [NCI GDC data access policy](https://docs.gdc.cancer.gov/Encyclopedia/pages/Data_Access_Policy/)
  defines the conditions for open and controlled GDC data.

## Deterministic verification

Verification reads committed JSON metadata and generated schemas only. It
does not resolve artifact URIs, download images, or use credentials. This path
works for large, gated, and controlled sources because their artifacts remain
reference-only records.

```bash
mise //data-products/pathologize/stain-assay-provenance:schemas
mise //data-products/pathologize/stain-assay-provenance:verify
mise //data-products/pathologize/stain-assay-provenance:check
```
