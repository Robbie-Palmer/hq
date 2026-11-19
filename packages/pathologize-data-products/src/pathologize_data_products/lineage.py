from __future__ import annotations

from pathologize_data_products.models import ArtifactReference, DerivedArtifact, DerivedProduct
from pathologize_data_products.resolver import (
    ArtifactReferenceKey,
    ArtifactResolver,
    artifact_reference_key,
)


class LineageError(RuntimeError):
    pass


def _visit_reference(
    reference: ArtifactReference,
    derived: dict[ArtifactReferenceKey, DerivedArtifact],
    resolver: ArtifactResolver,
    visiting: set[ArtifactReferenceKey],
    visited: set[ArtifactReferenceKey],
) -> None:
    artifact = derived.get(artifact_reference_key(reference)) or resolver.derived_artifact(
        reference
    )
    if artifact is None:
        resolver.resolve(reference)
    else:
        _visit_derived_artifact(artifact, derived, resolver, visiting, visited)


def _visit_derived_artifact(
    artifact: DerivedArtifact,
    derived: dict[ArtifactReferenceKey, DerivedArtifact],
    resolver: ArtifactResolver,
    visiting: set[ArtifactReferenceKey],
    visited: set[ArtifactReferenceKey],
) -> None:
    key = artifact_reference_key(artifact.reference)
    if key in visited:
        return
    if key in visiting:
        raise LineageError(f"lineage cycle at {artifact.artifact_id}")
    visiting.add(key)
    for parent in artifact.parents:
        _visit_reference(parent, derived, resolver, visiting, visited)
    resolver.resolve(artifact.reference)
    visiting.remove(key)
    visited.add(key)


def validate_lineage(product: DerivedProduct, resolver: ArtifactResolver) -> None:
    derived: dict[ArtifactReferenceKey, DerivedArtifact] = {}
    for artifact in product.new_artifacts:
        key = artifact_reference_key(artifact.reference)
        if key in derived:
            raise LineageError(f"duplicate derived artifact reference at {artifact.artifact_id}")
        derived[key] = artifact
    visiting: set[ArtifactReferenceKey] = set()
    visited: set[ArtifactReferenceKey] = set()

    for record in product.records:
        for upstream in record.upstream_artifacts:
            _visit_reference(upstream, derived, resolver, visiting, visited)
    for artifact in product.published_artifacts:
        resolver.resolve(artifact.reference)
    for artifact in product.new_artifacts:
        _visit_derived_artifact(artifact, derived, resolver, visiting, visited)
