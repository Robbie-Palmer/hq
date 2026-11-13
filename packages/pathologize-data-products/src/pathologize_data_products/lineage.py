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


def _visit_derived_artifact(
    artifact: DerivedArtifact,
    derived: dict[tuple[str, str, str], DerivedArtifact],
    resolver: ArtifactResolver,
    visiting: set[tuple[str, str, str]],
    visited: set[tuple[str, str, str]],
) -> None:
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
            _visit_derived_artifact(parent_artifact, derived, resolver, visiting, visited)
    resolver.resolve(artifact.reference)
    visiting.remove(key)
    visited.add(key)


def validate_lineage(product: DerivedProduct, resolver: ArtifactResolver) -> None:
    derived = {_key(artifact.reference): artifact for artifact in product.new_artifacts}
    visiting: set[tuple[str, str, str]] = set()
    visited: set[tuple[str, str, str]] = set()

    for record in product.records:
        for upstream in record.upstream_artifacts:
            resolver.resolve(upstream)
    for artifact in product.published_artifacts:
        resolver.resolve(artifact.reference)
    for artifact in product.new_artifacts:
        _visit_derived_artifact(artifact, derived, resolver, visiting, visited)
