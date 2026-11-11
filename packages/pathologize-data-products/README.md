# Pathologize data-product contracts

This package makes the boundary in Pathologize PDR 009 executable. It keeps
source ownership separate from derived composition without imposing one
ontology on every pathology dataset.

A source product owns retrieval, rights, checksums, publisher identities,
native ontology, publisher roles, and original artifacts for one third-party
dataset. `require_unique_source_owners` rejects two products that claim the
same dataset.

A derived product owns compact contract artifacts and genuinely new bytes.
Composed records point to versioned upstream artifacts. They do not copy an
upstream WSI, mask, tile, embedding, or other artifact into a new product.
New artifacts record the operation, parameters, code revision, and every
parent artifact.

Upstream products may be source or derived products. This permits recursive
lineage such as:

```text
source WSI -> segmentation mask -> measurements or embeddings -> MIL bag
           -> transformed image -> label evidence             -> model input
```

The contract defines reference roles for bags, instances, label evidence,
features, and model inputs. Those roles describe data lineage only. This
package does not train models or define classifier behavior.

`ArtifactResolver` resolves a reference within its registered product root,
checks the source-record identity, and verifies SHA-256 for local artifacts.
`validate_lineage` follows parents through any number of derived products and
rejects missing artifacts or cycles.

## Existing products

The migration functions read the current GrandQC, NuCLS, and AIRAQc contracts
without changing them. `existing_product_migration_plans` limits migration to
the three source products and two Pathologize derived products that existed
when this contract was introduced. Each plan preserves existing data and
output paths. Source bytes remain in their owning project.

Inspect the plans with:

```bash
mise //packages/pathologize-data-products:sync
mise exec --cwd packages/pathologize-data-products -- \
  uv run --locked pathologize-data-products migration_plan --repository ../..
```

## DVC stale detection

[`examples/dvc-stale-detection`](examples/dvc-stale-detection) is a small
two-product DVC graph. The derived stage depends on the source product's
`dvc.lock`, source contract, and records interface. Its test changes only the
copied source lock and proves that `dvc status` marks the derived stage stale
while the committed derived output remains byte-for-byte unchanged.

Run all checks through mise:

```bash
mise //packages/pathologize-data-products:check
```
