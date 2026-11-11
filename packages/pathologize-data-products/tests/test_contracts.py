import hashlib
from pathlib import Path

import pytest
from conftest import ArtifactFactory
from pydantic import ValidationError

from pathologize_data_products import (
    AccessTier,
    ArtifactReference,
    ArtifactRole,
    Checksum,
    ComposedRecord,
    DerivedArtifact,
    DerivedArtifactKind,
    DerivedProduct,
    NativeConcept,
    NativeOntology,
    Operation,
    ProductVersion,
    PublishedArtifact,
    PublishedArtifactKind,
    PublisherIdentity,
    Retrieval,
    Rights,
    SourceProduct,
    require_unique_source_owners,
)


def _digest(value: bytes) -> Checksum:
    return Checksum(value=hashlib.sha256(value).hexdigest())


def _source_product(
    product: str, dataset: str, rights: Rights, artifact: ArtifactReference
) -> SourceProduct:
    identity = ProductVersion(product=product, version="v1")
    return SourceProduct(
        identity=identity,
        third_party_dataset=dataset,
        publisher_identities=(PublisherIdentity(namespace="doi", value="10.1/example"),),
        retrieval=(Retrieval(uri="https://example.test/source", checksum=artifact.checksum),),
        rights=rights,
        access_tier=AccessTier.PUBLIC,
        native_ontology=NativeOntology(
            id="native", concepts=(NativeConcept(id="1", label="tissue"),)
        ),
        publisher_roles=("publisher_test",),
        original_artifacts=(artifact.model_copy(update={"product": identity}),),
    )


def test_artifact_reference_requires_one_safe_location_and_spatial_frame(
    rights: Rights,
) -> None:
    payload = {
        "product": {"product": "source/wsi", "version": "v1"},
        "source_record": "slide-1",
        "role": "source_image",
        "checksum": _digest(b"slide").model_dump(),
        "media_type": "image/tiff",
        "rights": rights.model_dump(mode="json"),
        "access_tier": "public",
    }
    with pytest.raises(ValidationError, match="exactly one path or URI"):
        ArtifactReference.model_validate(payload)
    payload["path"] = "../slide.svs"
    with pytest.raises(ValidationError, match="within its product root"):
        ArtifactReference.model_validate(payload)
    payload["path"] = "slides/slide.svs"
    with pytest.raises(ValidationError, match="coordinate frame"):
        ArtifactReference.model_validate(payload)


def test_one_source_product_owns_each_third_party_dataset(
    tmp_path: Path, rights: Rights, make_artifact: ArtifactFactory
) -> None:
    first_identity = ProductVersion(product="publisher/a", version="v1")
    second_identity = ProductVersion(product="publisher/b", version="v1")
    first_ref = make_artifact(first_identity, tmp_path / "a", "source.json", b"a")
    second_ref = make_artifact(second_identity, tmp_path / "b", "source.json", b"b")
    first = _source_product("publisher/a", "shared-dataset", rights, first_ref)
    second = _source_product("publisher/b", "shared-dataset", rights, second_ref)

    with pytest.raises(ValueError, match="multiple owners"):
        require_unique_source_owners([first, second])
    require_unique_source_owners([first])


def test_derived_product_references_upstream_without_copying_images(
    tmp_path: Path, make_artifact: ArtifactFactory
) -> None:
    source = ProductVersion(product="source/wsi", version="v1")
    derived = ProductVersion(product="pathologize/segmentation", version="v2")
    image = make_artifact(
        source,
        tmp_path / "source",
        "slides/a.svs",
        b"slide",
        role=ArtifactRole.SOURCE_IMAGE,
        media_type="image/tiff",
    )
    mask = make_artifact(
        derived,
        tmp_path / "derived",
        "masks/a.png",
        b"mask",
        role=ArtifactRole.MASK,
        media_type="image/png",
    )
    manifest = make_artifact(
        derived,
        tmp_path / "derived",
        "manifests/product.json",
        b"{}",
        role=ArtifactRole.MANIFEST,
    )
    product = DerivedProduct(
        identity=derived,
        upstream_products=(source,),
        records=(
            ComposedRecord(
                product=derived,
                record_id="segmentation:a",
                upstream_artifacts=(image,),
                derived_artifact_ids=("mask:a",),
                adapter="adapters/wsi-to-mask.json",
                partition="all",
            ),
        ),
        published_artifacts=(
            PublishedArtifact(kind=PublishedArtifactKind.MANIFEST, reference=manifest),
        ),
        new_artifacts=(
            DerivedArtifact(
                artifact_id="mask:a",
                kind=DerivedArtifactKind.MASK,
                reference=mask,
                operation=Operation(
                    name="segment_tissue",
                    parameters={"threshold": 0.5},
                    code_revision="0123456789abcdef",
                ),
                parents=(image,),
            ),
        ),
    )
    assert product.records[0].upstream_artifacts == (image,)

    copied_image = PublishedArtifact(kind=PublishedArtifactKind.MANIFEST, reference=mask)
    with pytest.raises(ValidationError, match="cannot copy source image bytes"):
        DerivedProduct(
            identity=derived,
            upstream_products=(source,),
            records=(),
            published_artifacts=(copied_image,),
            new_artifacts=(),
        )


def test_recursive_data_roles_do_not_define_training_behavior(
    tmp_path: Path, make_artifact: ArtifactFactory
) -> None:
    upstream = ProductVersion(product="pathologize/measurements", version="v1")
    product = ProductVersion(product="pathologize/mil-inputs", version="v1")
    feature = make_artifact(
        upstream,
        tmp_path / "upstream",
        "features/a.parquet",
        b"feature",
        role=ArtifactRole.FEATURE,
        media_type="application/vnd.apache.parquet",
    )
    bag = make_artifact(
        product,
        tmp_path / "product",
        "bags/a.json",
        b"bag",
        role=ArtifactRole.BAG,
    )
    derived = DerivedProduct(
        identity=product,
        upstream_products=(upstream,),
        records=(
            ComposedRecord(
                product=product,
                record_id="bag:a",
                upstream_artifacts=(feature,),
                derived_artifact_ids=("bag:a",),
                adapter="adapters/measurement-to-bag.json",
                partition="train",
                attributes={"instance_role": ArtifactRole.INSTANCE.value},
            ),
        ),
        published_artifacts=(),
        new_artifacts=(
            DerivedArtifact(
                artifact_id="bag:a",
                kind=DerivedArtifactKind.BAG,
                reference=bag,
                operation=Operation(
                    name="assemble_bag",
                    parameters={"ordering": "source_record"},
                    code_revision="abcdef",
                ),
                parents=(feature,),
            ),
        ),
    )
    serialized = derived.model_dump_json()
    assert "optimizer" not in serialized
    assert "model_input" in {role.value for role in ArtifactRole}
    assert "label_evidence" in {role.value for role in ArtifactRole}
