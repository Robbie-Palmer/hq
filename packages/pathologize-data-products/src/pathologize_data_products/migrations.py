from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

from pathologize_data_products.models import (
    AccessTier,
    ArtifactReference,
    ArtifactRole,
    Checksum,
    CoordinateFrame,
    MigrationPlan,
    NativeConcept,
    NativeOntology,
    PhysicalScale,
    ProductVersion,
    PublisherIdentity,
    Retrieval,
    Rights,
    SourceProduct,
    require_unique_source_owners,
)


class MigrationError(RuntimeError):
    pass


def _object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise MigrationError(f"{path} must contain a JSON object")
    return cast(dict[str, Any], value)


def _rights(license_record: dict[str, Any]) -> Rights:
    return Rights(
        license=str(license_record["spdx_id"]),
        redistribution=str(license_record.get("redistribution", "Follow the linked licence.")),
        evidence_uri=str(license_record.get("evidence_url", license_record["url"])),
    )


def migrate_grandqc_source(project: Path) -> SourceProduct:
    manifest = _object(project / "manifest.json")
    archive = cast(dict[str, Any], manifest["archive"])
    license_record = cast(dict[str, Any], manifest["license"])
    rights = _rights(license_record)
    identity = ProductVersion(product="grandqc/mpp20", version=str(manifest["source_version"]))
    checksum = Checksum(value=str(archive["sha256"]))
    native_labels = cast(list[dict[str, Any]], manifest["native_labels"])
    artifact = ArtifactReference(
        product=identity,
        source_record=str(manifest["dataset_id"]),
        role=ArtifactRole.SOURCE_ARCHIVE,
        path=f"data/raw/{archive['filename']}",
        checksum=checksum,
        media_type="application/x-tar",
        rights=rights,
        access_tier=AccessTier.PUBLIC,
    )
    return SourceProduct(
        identity=identity,
        third_party_dataset=str(manifest["dataset_id"]),
        publisher_identities=(PublisherIdentity(namespace="doi", value=str(manifest["doi"])),),
        retrieval=(Retrieval(uri=str(archive["url"]), checksum=checksum),),
        rights=rights,
        access_tier=AccessTier.PUBLIC,
        native_ontology=NativeOntology(
            id="grandqc-mpp20-native-labels",
            concepts=tuple(
                NativeConcept(id=str(label["id"]), label=str(label["name"]))
                for label in native_labels
            ),
        ),
        publisher_roles=(str(manifest["native_role"]),),
        original_artifacts=(artifact,),
    )


def migrate_nucls_source(project: Path) -> SourceProduct:
    manifest = _object(project / "manifest.json")
    license_record = cast(dict[str, Any], manifest["license"])
    rights = _rights(license_record)
    identity = ProductVersion(product="nucls/corrected-single-rater", version="20220301")
    archives = cast(list[dict[str, Any]], manifest["archives"])
    role_by_name = {
        "rgb": ArtifactRole.SOURCE_IMAGE,
        "annotations": ArtifactRole.SOURCE_ANNOTATION,
        "splits": ArtifactRole.SOURCE_RECORDS,
    }
    references = tuple(
        ArtifactReference(
            product=identity,
            source_record=f"{manifest['dataset_id']}:{archive['name']}",
            role=role_by_name[str(archive["name"])],
            uri=str(archive["url"]),
            checksum=Checksum(value=str(archive["sha256"])),
            media_type="application/zip",
            rights=rights,
            access_tier=AccessTier.PUBLIC,
        )
        for archive in archives
    )
    labels = [
        *cast(list[str], manifest["classification_labels"]),
        *cast(dict[str, str], manifest["unmappable_categories"]).keys(),
    ]
    return SourceProduct(
        identity=identity,
        third_party_dataset=str(manifest["dataset_id"]),
        publisher_identities=(
            PublisherIdentity(namespace="doi", value=str(manifest["doi"])),
            PublisherIdentity(namespace="paper_doi", value=str(manifest["paper_doi"])),
            PublisherIdentity(namespace="publisher", value=str(manifest["publisher"])),
        ),
        retrieval=tuple(
            Retrieval(uri=str(archive["url"]), checksum=Checksum(value=str(archive["sha256"])))
            for archive in archives
        ),
        rights=rights,
        access_tier=AccessTier.PUBLIC,
        native_ontology=NativeOntology(
            id="nucls-corrected-single-rater-native-classification",
            concepts=tuple(NativeConcept(id=label, label=label) for label in labels),
        ),
        publisher_roles=("train", "test"),
        original_artifacts=references,
    )


def _airaqc_media_type(format_name: str) -> str:
    if format_name == "aperio_svs":
        return "image/tiff"
    if format_name == "png_mask":
        return "image/png"
    raise MigrationError(f"unknown AIRAQc asset format {format_name!r}")


def migrate_airaqc_source(project: Path) -> SourceProduct:
    collection = _object(project / "contracts/collection.json")
    subset = _object(project / "contracts/subset.json")
    asset_manifest = _object(project / "contracts/assets.json")
    corpus = _object(project / "records/native-corpus.json")
    license_record = cast(dict[str, Any], collection["license"])
    rights = _rights(license_record)
    identity = ProductVersion(product="airaqc/tcga-public-pilot", version="v1")
    slides = cast(list[dict[str, Any]], corpus["slides"])
    artifact_records: dict[str, tuple[str, float]] = {}
    for slide in slides:
        scale = float(slide["micrometres_per_pixel"])
        artifact_records[str(cast(dict[str, Any], slide["source"])["relative_path"])] = (
            str(slide["slide_id"]),
            scale,
        )
        artifact_records[str(cast(dict[str, Any], slide["annotation"])["relative_path"])] = (
            str(slide["slide_id"]),
            scale,
        )
    coordinate_frame = CoordinateFrame(
        name="native_full_resolution_pixels", axes=("x", "y"), origin="top_left"
    )
    assets = cast(list[dict[str, Any]], asset_manifest["assets"])
    references: list[ArtifactReference] = []
    retrieval: list[Retrieval] = []
    for asset in assets:
        relative_path = str(asset["relative_path"])
        source_record, scale = artifact_records[relative_path]
        checksum = Checksum(value=str(asset["sha256"]))
        role = (
            ArtifactRole.SOURCE_IMAGE
            if asset["image_role"] == "whole_slide"
            else ArtifactRole.SOURCE_ANNOTATION
        )
        references.append(
            ArtifactReference(
                product=identity,
                source_record=source_record,
                role=role,
                path=f"data/raw/{relative_path}",
                checksum=checksum,
                media_type=_airaqc_media_type(str(asset["format"])),
                rights=rights,
                access_tier=AccessTier.PUBLIC,
                coordinate_frame=coordinate_frame,
                physical_scale=PhysicalScale(
                    micrometres_per_pixel_x=scale,
                    micrometres_per_pixel_y=scale,
                ),
            )
        )
        retrieval.append(Retrieval(uri=str(asset["source_url"]), checksum=checksum))
    labels = sorted(
        {label for slide in slides for label in cast(dict[str, int], slide["annotation_counts"])}
    )
    return SourceProduct(
        identity=identity,
        third_party_dataset=str(subset["subset_id"]),
        publisher_identities=(
            PublisherIdentity(namespace="collection", value=str(collection["collection_id"])),
            PublisherIdentity(namespace="subset", value=str(subset["subset_id"])),
        ),
        retrieval=tuple(retrieval),
        rights=rights,
        access_tier=AccessTier.PUBLIC,
        native_ontology=NativeOntology(
            id="airaqc-artifact-annotations",
            concepts=tuple(NativeConcept(id=label, label=label) for label in labels),
        ),
        publisher_roles=("fixed_public_pilot_test_partition",),
        original_artifacts=tuple(references),
    )


def migrate_existing_sources(repository: Path) -> tuple[SourceProduct, ...]:
    products = (
        migrate_grandqc_source(repository / "data-products/grandqc/mpp20"),
        migrate_nucls_source(repository / "data-products/nucls/corrected-single-rater"),
        migrate_airaqc_source(repository / "data-products/airaqc/tcga-public-pilot"),
    )
    require_unique_source_owners(list(products))
    return products


def existing_product_migration_plans(repository: Path) -> tuple[MigrationPlan, ...]:
    products = repository / "data-products"
    expected = {
        "grandqc/mpp20": products / "grandqc/mpp20/manifest.json",
        "nucls/corrected-single-rater": products / "nucls/corrected-single-rater/manifest.json",
        "airaqc/tcga-public-pilot": products / "airaqc/tcga-public-pilot/contracts/subset.json",
        "pathologize/slide-quality": products / "pathologize/slide-quality/imports.json",
        "pathologize/nucleus-analysis": products / "pathologize/nucleus-analysis/imports.json",
    }
    missing = [str(path) for path in expected.values() if not path.is_file()]
    if missing:
        raise MigrationError(f"existing product contracts are missing: {missing}")
    source_changes = (
        "publish one source-product manifest beside the native contract",
        "add stable artifact references without moving or copying original bytes",
    )
    derived_changes = (
        "replace bare source paths with pinned upstream artifact references",
        "publish tables, manifests, adapters, partitions, and reports in place",
        "record operation, parameters, code revision, and parents for new artifacts",
    )
    return (
        MigrationPlan(
            product=ProductVersion(product="grandqc/mpp20", version="source contract v1"),
            current_contract="manifest.json",
            target_contract="contracts/source-product.json",
            bounded_changes=source_changes,
            preserved_paths=("data/raw", "data/native", "outputs/native-index.jsonl"),
        ),
        MigrationPlan(
            product=ProductVersion(product="nucls/corrected-single-rater", version="20220301"),
            current_contract="manifest.json",
            target_contract="contracts/source-product.json",
            bounded_changes=source_changes,
            preserved_paths=("data/native", "outputs/native-index.jsonl"),
        ),
        MigrationPlan(
            product=ProductVersion(product="airaqc/tcga-public-pilot", version="v1"),
            current_contract="contracts/subset.json",
            target_contract="contracts/source-product.json",
            bounded_changes=source_changes,
            preserved_paths=("data/raw", "outputs/native-corpus.json"),
        ),
        MigrationPlan(
            product=ProductVersion(product="pathologize/slide-quality", version="v1"),
            current_contract="imports.json",
            target_contract="contracts/derived-product.json",
            bounded_changes=derived_changes,
            preserved_paths=(
                "outputs/harmonized",
                "outputs/partitions.json",
                "outputs/reconciliation.json",
            ),
        ),
        MigrationPlan(
            product=ProductVersion(product="pathologize/nucleus-analysis", version="v1"),
            current_contract="imports.json",
            target_contract="contracts/derived-product.json",
            bounded_changes=derived_changes,
            preserved_paths=(
                "outputs/records.jsonl",
                "outputs/cohort.json",
                "outputs/partitions.json",
            ),
        ),
    )
