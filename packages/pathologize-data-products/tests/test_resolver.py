from pathlib import Path

import pytest
from conftest import ArtifactFactory

from pathologize_data_products import (
    ArtifactResolutionError,
    ArtifactResolver,
    ArtifactRole,
    ProductVersion,
    Rights,
)


def test_resolver_checks_product_record_path_and_checksum(
    tmp_path: Path, make_artifact: ArtifactFactory
) -> None:
    product = ProductVersion(product="source/wsi", version="v1")
    root = tmp_path / "source"
    reference = make_artifact(
        product,
        root,
        "slides/a.svs",
        b"slide",
        record="slide-a",
        role=ArtifactRole.SOURCE_IMAGE,
        media_type="image/tiff",
    )
    resolver = ArtifactResolver()
    resolver.register(product, root=root, source_records={"slide-a"})

    assert resolver.resolve(reference).path == root / "slides/a.svs"
    (root / "slides/a.svs").write_bytes(b"changed")
    with pytest.raises(ArtifactResolutionError, match="checksum differs"):
        resolver.resolve(reference)


def test_resolver_rejects_unregistered_products_and_records(
    tmp_path: Path, make_artifact: ArtifactFactory
) -> None:
    product = ProductVersion(product="source/wsi", version="v1")
    reference = make_artifact(product, tmp_path, "record.json", b"{}")
    resolver = ArtifactResolver()
    with pytest.raises(ArtifactResolutionError, match="unregistered product"):
        resolver.resolve(reference)
    resolver.register(product, root=tmp_path, source_records={"another-record"})
    with pytest.raises(ArtifactResolutionError, match="unknown source record"):
        resolver.resolve(reference)
    with pytest.raises(ArtifactResolutionError, match="already registered"):
        resolver.register(product, root=tmp_path / "other", source_records={"record-1"})


def test_resolver_returns_pinned_remote_uri(rights: Rights) -> None:
    from pathologize_data_products import AccessTier, ArtifactReference, Checksum

    product = ProductVersion(product="source/remote", version="v1")
    reference = ArtifactReference(
        product=product,
        source_record="remote-1",
        role=ArtifactRole.SOURCE_RECORDS,
        uri="https://example.test/records.json",
        checksum=Checksum(value="a" * 64),
        media_type="application/json",
        rights=rights,
        access_tier=AccessTier.PUBLIC,
    )
    resolver = ArtifactResolver()
    resolver.register(product, root=None, source_records={"remote-1"})

    assert resolver.resolve(reference).uri == "https://example.test/records.json"


def test_resolver_rejects_derived_artifacts_owned_by_another_product(
    tmp_path: Path, make_artifact: ArtifactFactory
) -> None:
    from pathologize_data_products import DerivedArtifact, DerivedArtifactKind, Operation

    owner = ProductVersion(product="pathologize/owner", version="v1")
    other = ProductVersion(product="pathologize/other", version="v1")
    parent = make_artifact(owner, tmp_path, "parent.json", b"parent")
    reference = make_artifact(other, tmp_path, "derived.json", b"derived")
    artifact = DerivedArtifact(
        artifact_id="derived",
        kind=DerivedArtifactKind.FEATURE,
        reference=reference,
        operation=Operation(name="derive", parameters={}, code_revision="abc"),
        parents=(parent,),
    )

    with pytest.raises(ArtifactResolutionError, match="must belong"):
        ArtifactResolver().register(
            owner,
            root=tmp_path,
            source_records={"record-1"},
            derived_artifacts=(artifact,),
        )
