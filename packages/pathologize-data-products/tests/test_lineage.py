from pathlib import Path

import pytest
from conftest import ArtifactFactory

from pathologize_data_products import (
    ArtifactResolutionError,
    ArtifactResolver,
    ArtifactRole,
    ComposedRecord,
    DerivedArtifact,
    DerivedArtifactKind,
    DerivedProduct,
    LineageError,
    Operation,
    ProductVersion,
    validate_lineage,
)


def _operation(name: str) -> Operation:
    return Operation(name=name, parameters={"fixture": True}, code_revision="abc123")


def test_lineage_recurses_from_source_wsi_through_derived_products(
    tmp_path: Path, make_artifact: ArtifactFactory
) -> None:
    source = ProductVersion(product="source/wsi", version="v1")
    segmentation = ProductVersion(product="pathologize/segmentation", version="v1")
    measurement = ProductVersion(product="pathologize/measurements", version="v1")
    model_input = ProductVersion(product="pathologize/mil-inputs", version="v1")
    roots = {
        source: tmp_path / "source",
        segmentation: tmp_path / "segmentation",
        measurement: tmp_path / "measurement",
        model_input: tmp_path / "model-input",
    }
    image = make_artifact(
        source,
        roots[source],
        "slides/a.svs",
        b"slide",
        role=ArtifactRole.SOURCE_IMAGE,
        media_type="image/tiff",
    )
    mask = make_artifact(
        segmentation,
        roots[segmentation],
        "masks/a.png",
        b"mask",
        role=ArtifactRole.MASK,
        media_type="image/png",
    )
    features = make_artifact(
        measurement,
        roots[measurement],
        "features/a.parquet",
        b"features",
        role=ArtifactRole.FEATURE,
        media_type="application/vnd.apache.parquet",
    )
    bag = make_artifact(
        model_input,
        roots[model_input],
        "bags/a.json",
        b"bag",
        role=ArtifactRole.MODEL_INPUT,
    )
    segmentation_product = DerivedProduct(
        identity=segmentation,
        upstream_products=(source,),
        records=(
            ComposedRecord(
                product=segmentation,
                record_id="segmentation:a",
                upstream_artifacts=(image,),
                derived_artifact_ids=("mask:a",),
                adapter="wsi-to-mask",
                partition="all",
            ),
        ),
        published_artifacts=(),
        new_artifacts=(
            DerivedArtifact(
                artifact_id="mask:a",
                kind=DerivedArtifactKind.MASK,
                reference=mask,
                operation=_operation("segment"),
                parents=(image,),
            ),
        ),
    )
    measurement_product = DerivedProduct(
        identity=measurement,
        upstream_products=(segmentation,),
        records=(
            ComposedRecord(
                product=measurement,
                record_id="measurement:a",
                upstream_artifacts=(mask,),
                derived_artifact_ids=("features:a",),
                adapter="mask-to-features",
                partition="all",
            ),
        ),
        published_artifacts=(),
        new_artifacts=(
            DerivedArtifact(
                artifact_id="features:a",
                kind=DerivedArtifactKind.FEATURE,
                reference=features,
                operation=_operation("measure"),
                parents=(mask,),
            ),
        ),
    )
    model_input_product = DerivedProduct(
        identity=model_input,
        upstream_products=(measurement,),
        records=(
            ComposedRecord(
                product=model_input,
                record_id="bag:a",
                upstream_artifacts=(features,),
                derived_artifact_ids=("bag:a",),
                adapter="features-to-bag",
                partition="train",
            ),
        ),
        published_artifacts=(),
        new_artifacts=(
            DerivedArtifact(
                artifact_id="bag:a",
                kind=DerivedArtifactKind.MODEL_INPUT,
                reference=bag,
                operation=_operation("assemble_bag"),
                parents=(features,),
            ),
        ),
    )
    resolver = ArtifactResolver()
    contracts = {
        segmentation: segmentation_product,
        measurement: measurement_product,
        model_input: model_input_product,
    }
    for product, root in roots.items():
        contract = contracts.get(product)
        resolver.register(
            product,
            root=root,
            source_records={"record-1"},
            derived_artifacts=contract.new_artifacts if contract is not None else (),
        )

    validate_lineage(segmentation_product, resolver)
    validate_lineage(measurement_product, resolver)
    validate_lineage(model_input_product, resolver)
    (roots[source] / "slides/a.svs").write_bytes(b"changed upstream source")
    with pytest.raises(ArtifactResolutionError, match="checksum differs"):
        validate_lineage(model_input_product, resolver)


def test_lineage_rejects_cycles(tmp_path: Path, make_artifact: ArtifactFactory) -> None:
    product = ProductVersion(product="pathologize/cycle", version="v1")
    root = tmp_path / "cycle"
    first_ref = make_artifact(product, root, "first.json", b"first")
    second_ref = make_artifact(product, root, "second.json", b"second")
    first = DerivedArtifact(
        artifact_id="first",
        kind=DerivedArtifactKind.FEATURE,
        reference=first_ref,
        operation=_operation("first"),
        parents=(second_ref,),
    )
    second = DerivedArtifact(
        artifact_id="second",
        kind=DerivedArtifactKind.FEATURE,
        reference=second_ref,
        operation=_operation("second"),
        parents=(first_ref,),
    )
    product_contract = DerivedProduct(
        identity=product,
        upstream_products=(ProductVersion(product="source/root", version="v1"),),
        records=(),
        published_artifacts=(),
        new_artifacts=(first, second),
    )
    resolver = ArtifactResolver()
    resolver.register(product, root=root, source_records={"record-1"})

    with pytest.raises(LineageError, match="lineage cycle"):
        validate_lineage(product_contract, resolver)
