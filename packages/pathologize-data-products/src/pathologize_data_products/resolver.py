from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

from pathologize_data_products.models import ArtifactReference, DerivedArtifact, ProductVersion


class ArtifactResolutionError(RuntimeError):
    pass


@dataclass(frozen=True)
class ProductRegistration:
    identity: ProductVersion
    root: Path | None
    source_records: frozenset[str]
    derived_artifacts: tuple[DerivedArtifact, ...]


@dataclass(frozen=True)
class ResolvedArtifact:
    reference: ArtifactReference
    path: Path | None
    uri: str | None


class ArtifactResolver:
    def __init__(self) -> None:
        self._products: dict[tuple[str, str], ProductRegistration] = {}

    def register(
        self,
        identity: ProductVersion,
        *,
        root: Path | None,
        source_records: set[str] | frozenset[str],
        derived_artifacts: tuple[DerivedArtifact, ...] = (),
    ) -> None:
        key = (identity.product, identity.version)
        if any(artifact.reference.product != identity for artifact in derived_artifacts):
            raise ArtifactResolutionError("registered derived artifacts must belong to the product")
        registration = ProductRegistration(
            identity, root, frozenset(source_records), derived_artifacts
        )
        existing = self._products.get(key)
        if existing is not None and existing != registration:
            raise ArtifactResolutionError(
                f"product {identity.product}@{identity.version} is already registered"
            )
        self._products[key] = registration

    def derived_artifact(self, reference: ArtifactReference) -> DerivedArtifact | None:
        key = (reference.product.product, reference.product.version)
        registration = self._products.get(key)
        if registration is None:
            return None
        matches = [
            artifact
            for artifact in registration.derived_artifacts
            if artifact.reference.checksum == reference.checksum
        ]
        if len(matches) > 1:
            raise ArtifactResolutionError(
                "derived artifact checksum is ambiguous within its product"
            )
        return matches[0] if matches else None

    def resolve(self, reference: ArtifactReference) -> ResolvedArtifact:
        key = (reference.product.product, reference.product.version)
        registration = self._products.get(key)
        if registration is None:
            raise ArtifactResolutionError(
                f"unregistered product {reference.product.product}@{reference.product.version}"
            )
        if reference.source_record not in registration.source_records:
            raise ArtifactResolutionError(
                f"unknown source record {reference.source_record!r} in "
                f"{reference.product.product}@{reference.product.version}"
            )
        if reference.uri is not None:
            return ResolvedArtifact(reference, None, str(reference.uri))
        if reference.path is None or registration.root is None:
            raise ArtifactResolutionError("path reference requires a registered product root")
        root = registration.root.resolve()
        path = (root / reference.path).resolve()
        if not path.is_relative_to(root):
            raise ArtifactResolutionError("artifact path escapes its registered product root")
        if not path.is_file():
            raise ArtifactResolutionError(f"artifact does not exist: {path}")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != reference.checksum.value:
            raise ArtifactResolutionError(
                f"artifact checksum differs for {reference.product.product}:{reference.path}"
            )
        return ResolvedArtifact(reference, path, None)
