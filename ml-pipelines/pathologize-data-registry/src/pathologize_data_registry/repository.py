from __future__ import annotations

import hashlib
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import pydicom
from pydantic import BaseModel
from pydicom.errors import InvalidDicomError

from pathologize_data_registry.models import (
    AssetManifest,
    AssetRecord,
    CollectionManifest,
    RegistryIndex,
    SlideRecord,
    SubsetManifest,
    source_url_is_allowlisted,
)

PROJECT_DIR = Path(__file__).resolve().parents[2]


class RegistryValidationError(RuntimeError):
    pass


@dataclass(frozen=True)
class LoadedRegistry:
    root: Path
    index: RegistryIndex
    collections: dict[str, CollectionManifest]
    subsets: dict[str, SubsetManifest]
    asset_manifests: dict[str, AssetManifest]
    slides: dict[str, SlideRecord]


def _load_model[Model: BaseModel](root: Path, relative_path: str, model: type[Model]) -> Model:
    path = root / relative_path
    return model.model_validate_json(path.read_text(encoding="utf-8"))


def _keyed[Model: BaseModel](items: list[Model], attribute: str) -> dict[str, Model]:
    keyed: dict[str, Model] = {}
    for item in items:
        key = getattr(item, attribute)
        if key in keyed:
            raise RegistryValidationError(f"duplicate {attribute} {key}")
        keyed[key] = item
    return keyed


def load_registry(root: Path = PROJECT_DIR) -> LoadedRegistry:
    index = RegistryIndex.model_validate_json((root / "registry.json").read_text(encoding="utf-8"))
    collections = _keyed(
        [_load_model(root, path, CollectionManifest) for path in index.collections],
        "collection_id",
    )
    subsets = _keyed(
        [_load_model(root, path, SubsetManifest) for path in index.subsets], "subset_id"
    )
    asset_manifests = _keyed(
        [_load_model(root, path, AssetManifest) for path in index.asset_manifests],
        "asset_manifest_id",
    )
    slides = _keyed(
        [_load_model(root, path, SlideRecord) for path in index.slide_records], "slide_id"
    )
    return LoadedRegistry(
        root=root,
        index=index,
        collections=collections,
        subsets=subsets,
        asset_manifests=asset_manifests,
        slides=slides,
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_file(path: Path, asset: AssetRecord) -> list[str]:
    issues: list[str] = []
    if path.stat().st_size != asset.bytes:
        issues.append(f"{path}: expected {asset.bytes} bytes, found {path.stat().st_size}")
    actual_sha256 = sha256_file(path)
    if actual_sha256 != asset.sha256:
        issues.append(f"{path}: expected SHA-256 {asset.sha256}, found {actual_sha256}")
    return issues


def _string(value: object) -> str:
    return str(value) if value is not None else ""


def _dicom_role(dataset: pydicom.Dataset) -> str:
    image_type = [_string(value).upper() for value in getattr(dataset, "ImageType", [])]
    role = image_type[2] if len(image_type) > 2 else ""
    subtype = image_type[3] if len(image_type) > 3 else ""
    if role == "VOLUME":
        return "volume_resampled" if subtype == "RESAMPLED" else "volume_primary"
    return role.lower()


def _coded_values(sequence: Iterable[object] | None) -> set[tuple[str, str, str]]:
    values: set[tuple[str, str, str]] = set()
    for item in sequence if sequence is not None else ():
        values.add(
            (
                _string(getattr(item, "CodingSchemeDesignator", "")),
                _string(getattr(item, "CodeValue", "")),
                _string(getattr(item, "CodeMeaning", "")),
            )
        )
    return values


def _source_labels(dataset: pydicom.Dataset) -> set[tuple[str, str, str | None]]:
    labels: set[tuple[str, str, str | None]] = {
        ("collection", _string(getattr(dataset, "ClinicalTrialProtocolID", "")), None)
    }
    for specimen in getattr(dataset, "SpecimenDescriptionSequence", []):
        for scheme, code, meaning in _coded_values(
            getattr(specimen, "PrimaryAnatomicStructureSequence", [])
        ):
            labels.add(("primary_anatomic_structure", meaning, f"{scheme}:{code}"))
        for preparation in getattr(specimen, "SpecimenPreparationSequence", []):
            for content in getattr(preparation, "SpecimenPreparationStepContentItemSequence", []):
                concept_name = next(
                    iter(_coded_values(getattr(content, "ConceptNameCodeSequence", []))), None
                )
                if concept_name is None or concept_name[2] != "Using substance":
                    continue
                for scheme, code, meaning in _coded_values(
                    getattr(content, "ConceptCodeSequence", [])
                ):
                    labels.add(("staining_substance", meaning, f"{scheme}:{code}"))
    return labels


def _validate_primary_dicom(dataset: pydicom.Dataset, slide: SlideRecord, path: Path) -> list[str]:
    issues: list[str] = []
    resolution = slide.physical_resolution
    try:
        pixel_measures = dataset.SharedFunctionalGroupsSequence[0].PixelMeasuresSequence[0]
        spacing = [float(value) * 1000 for value in pixel_measures.PixelSpacing]
    except (AttributeError, IndexError, TypeError, ValueError):
        issues.append(f"{path}: missing source pixel spacing")
        spacing = []
    if spacing and (
        abs(spacing[0] - resolution.micrometres_per_pixel_y) > 1e-9
        or abs(spacing[1] - resolution.micrometres_per_pixel_x) > 1e-9
    ):
        issues.append(f"{path}: physical resolution differs from the slide record")
    expected_values = {
        "TotalPixelMatrixColumns": resolution.total_pixel_matrix_columns,
        "TotalPixelMatrixRows": resolution.total_pixel_matrix_rows,
        "Manufacturer": slide.scanner.manufacturer,
        "ManufacturerModelName": slide.scanner.model,
        "DeviceSerialNumber": slide.scanner.device_serial_number,
    }
    for keyword, expected in expected_values.items():
        actual = getattr(dataset, keyword, None)
        if (expected is None and _string(actual)) or (expected is not None and actual != expected):
            issues.append(f"{path}: DICOM {keyword} does not match the slide record")
    try:
        objective_powers = {
            float(item.ObjectiveLensPower)
            for item in getattr(dataset, "OpticalPathSequence", [])
            if hasattr(item, "ObjectiveLensPower")
        }
    except (TypeError, ValueError):
        issues.append(f"{path}: invalid objective power")
    else:
        if objective_powers != {slide.scanner.objective_power}:
            issues.append(f"{path}: objective power differs from the slide record")
    expected_labels = {
        (label.name, label.value, label.code) for label in slide.source_native_labels
    }
    missing_labels = expected_labels - _source_labels(dataset)
    if missing_labels:
        issues.append(f"{path}: missing source-native labels {sorted(missing_labels)}")
    return issues


def validate_dicom(path: Path, asset: AssetRecord, slide: SlideRecord) -> list[str]:
    issues: list[str] = []
    try:
        dataset = pydicom.dcmread(path, stop_before_pixels=True)
    except (OSError, InvalidDicomError) as error:
        return [f"{path}: invalid DICOM: {error}"]
    expected = {
        "PatientID": slide.identity.patient_id,
        "StudyInstanceUID": slide.identity.study_instance_uid,
        "SeriesInstanceUID": slide.identity.series_instance_uid,
        "SOPInstanceUID": asset.sop_instance_uid,
        "ContainerIdentifier": slide.identity.slide_container_id,
    }
    for keyword, value in expected.items():
        if _string(getattr(dataset, keyword, "")) != value:
            issues.append(f"{path}: DICOM {keyword} does not match the manifest")
    specimen_identities = {
        (
            _string(getattr(item, "SpecimenIdentifier", "")),
            _string(getattr(item, "SpecimenUID", "")),
        )
        for item in getattr(dataset, "SpecimenDescriptionSequence", [])
    }
    expected_specimen = (slide.identity.specimen_id, slide.identity.specimen_uid)
    if expected_specimen not in specimen_identities:
        issues.append(f"{path}: DICOM specimen identity does not match the slide record")
    if _dicom_role(dataset) != asset.image_role:
        issues.append(f"{path}: DICOM ImageType does not match role {asset.image_role}")
    if asset.relative_path == slide.physical_resolution.source_instance_path:
        issues.extend(_validate_primary_dicom(dataset, slide, path))
    return issues


def validate_registry(  # noqa: C901 - one pass reports all cross-manifest and asset issues.
    registry: LoadedRegistry, *, require_assets: bool
) -> list[str]:
    issues: list[str] = []
    for collection in registry.collections.values():
        for subset_id in collection.subsets:
            subset = registry.subsets.get(subset_id)
            if subset is None:
                issues.append(f"collection {collection.collection_id}: unknown subset {subset_id}")
            elif subset.collection_id != collection.collection_id:
                issues.append(f"subset {subset_id}: collection reference does not match")
    for subset in registry.subsets.values():
        collection = registry.collections.get(subset.collection_id)
        if collection is None:
            issues.append(f"subset {subset.subset_id}: unknown collection {subset.collection_id}")
            continue
        asset_manifest = registry.asset_manifests.get(subset.asset_manifest_id)
        if asset_manifest is None:
            issues.append(
                f"subset {subset.subset_id}: unknown asset manifest {subset.asset_manifest_id}"
            )
            continue
        if asset_manifest.subset_id != subset.subset_id:
            issues.append(f"subset {subset.subset_id}: asset manifest reference does not match")
        if len(asset_manifest.assets) != subset.asset_count:
            issues.append(f"subset {subset.subset_id}: asset count does not match")
        if sum(asset.bytes for asset in asset_manifest.assets) != subset.total_bytes:
            issues.append(f"subset {subset.subset_id}: byte count does not match")
        allowed_bases = tuple(str(url) for url in collection.access.download_base_urls)
        issues.extend(
            f"asset {asset.relative_path}: source URL is not allowlisted"
            for asset in asset_manifest.assets
            if not source_url_is_allowlisted(str(asset.source_url), allowed_bases)
        )
        subset_slides = [registry.slides.get(slide_id) for slide_id in subset.slide_ids]
        if any(slide is None for slide in subset_slides):
            issues.append(f"subset {subset.subset_id}: contains an unknown slide ID")
            continue
        slides = [slide for slide in subset_slides if slide is not None]
        manifest_paths = {asset.relative_path for asset in asset_manifest.assets}
        slide_paths = {path for slide in slides for path in slide.asset_paths}
        if slide_paths != manifest_paths:
            issues.append(f"subset {subset.subset_id}: slide and asset paths differ")
        for slide in slides:
            if slide.collection_id != subset.collection_id or slide.subset_id != subset.subset_id:
                issues.append(
                    f"slide {slide.slide_id}: collection or subset reference does not match"
                )
            asset_by_path = {asset.relative_path: asset for asset in asset_manifest.assets}
            for relative_path in slide.asset_paths:
                path = registry.root / subset.asset_root / relative_path
                if path.is_symlink():
                    issues.append(f"{path}: source asset must not be a symbolic link")
                    continue
                if not path.is_file():
                    if require_assets:
                        issues.append(f"{path}: required source asset is missing")
                    continue
                asset = asset_by_path[relative_path]
                issues.extend(validate_file(path, asset))
                issues.extend(validate_dicom(path, asset, slide))
    return issues


def require_valid_registry(
    root: Path = PROJECT_DIR, *, require_assets: bool = False
) -> LoadedRegistry:
    registry = load_registry(root)
    issues = validate_registry(registry, require_assets=require_assets)
    if issues:
        raise RegistryValidationError("\n".join(sorted(issues)))
    return registry
