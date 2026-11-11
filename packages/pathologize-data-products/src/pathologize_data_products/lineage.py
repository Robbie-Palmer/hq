from __future__ import annotations

from pathologize_data_products.models import ArtifactReference, DerivedArtifact, DerivedProduct
from pathologize_data_products.resolver import ArtifactResolver


class LineageError(RuntimeError):
    pass


def _key(reference: ArtifactReference) -> tuple[str, str, str]:
    return (
        reference.product.product,
        reference.product.version,
        reference.checksum.value,
    )


def validate_lineage(product: DerivedProduct, resolver: ArtifactResolver) -> None:
    derived = {_key(artifact.reference): artifact for artifact in product.new_artifacts}
    visiting: set[tuple[str, str, str]] = set()
    visited: set[tuple[str, str, str]] = set()

    def visit(artifact: DerivedArtifact) -> None:
        key = _key(artifact.reference)
        if key in visited:
            return
        if key in visiting:
            raise LineageError(f"lineage cycle at {artifact.artifact_id}")
        visiting.add(key)
        for parent in artifact.parents:
            parent_artifact = derived.get(_key(parent)) or resolver.derived_artifact(parent)
            if parent_artifact is None:
                resolver.resolve(parent)
            else:
                visit(parent_artifact)
        resolver.resolve(artifact.reference)
        visiting.remove(key)
        visited.add(key)

    for record in product.records:
        for upstream in record.upstream_artifacts:
            resolver.resolve(upstream)
    for artifact in product.published_artifacts:
        resolver.resolve(artifact.reference)
    for artifact in product.new_artifacts:
        visit(artifact)
