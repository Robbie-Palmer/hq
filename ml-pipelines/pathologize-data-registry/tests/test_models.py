import json
import shutil
from pathlib import Path

import numpy as np
import pytest
import tifffile
from pydantic import ValidationError

from pathologize_data_registry.models import (
    AssetRecord,
    RegistryIndex,
    SlideRecord,
    SourceNativeLabel,
    SubsetManifest,
    source_url_is_allowlisted,
)
from pathologize_data_registry.repository import (
    load_registry,
    validate_aperio,
    validate_file,
    validate_registry,
)

PROJECT_DIR = Path(__file__).resolve().parents[1]


def test_committed_registry_has_complete_references() -> None:
    registry = load_registry(PROJECT_DIR)

    assert set(registry.collections) == {
        "airaqc-tcga",
        "camelyon16",
        "cptac-coad-idc",
        "panda",
    }
    assert validate_registry(registry, require_assets=False) == []
    assert registry.collections["panda"].access.authentication_required is True
    assert registry.collections["camelyon16"].registration_status == "manifest_only"


def test_registry_rejects_parent_traversal() -> None:
    payload = json.loads((PROJECT_DIR / "registry.json").read_text(encoding="utf-8"))
    payload["collections"] = ["../outside.json"]

    with pytest.raises(ValidationError, match="normalized project-relative path"):
        RegistryIndex.model_validate(payload)


def test_subset_contract_rejects_task_split() -> None:
    path = PROJECT_DIR / "manifests/subsets/cptac-coad-idc-v23-smallest-series.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["selection"]["task_split"] = "train"

    with pytest.raises(ValidationError):
        SubsetManifest.model_validate(payload)


def test_subset_contract_requires_data_raw_asset_root() -> None:
    path = PROJECT_DIR / "manifests/subsets/cptac-coad-idc-v23-smallest-series.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["asset_root"] = "derived/copied-slides"

    with pytest.raises(ValidationError, match="contained by data/raw"):
        SubsetManifest.model_validate(payload)


def test_asset_contract_rejects_non_https_source() -> None:
    with pytest.raises(ValidationError, match="HTTPS"):
        AssetRecord(
            relative_path="source.dcm",
            source_url="http://public.example.test/source.dcm",
            bytes=1,
            sha256="0" * 64,
            source_etag="0" * 32,
            sop_instance_uid="1.2.3",
            image_role="volume_primary",
        )


def test_source_allowlist_compares_origin_and_path_boundary() -> None:
    bases = ("https://public.example.test/series/",)

    assert source_url_is_allowlisted("https://public.example.test/series/asset.dcm", bases)
    assert not source_url_is_allowlisted("https://public.example.test/series-evil/a", bases)
    assert not source_url_is_allowlisted("https://public.example.test.evil/series/a", bases)
    assert not source_url_is_allowlisted("http://public.example.test/series/a", bases)


def test_slide_contract_allows_explicitly_missing_scanner_serial() -> None:
    path = PROJECT_DIR / "records/slides/cptac-coad-idc-09co003-0b1ee2c0.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["scanner"]["device_serial_number"] = None

    assert SlideRecord.model_validate(payload).scanner.device_serial_number is None


def test_source_label_requires_code_and_coding_scheme_together() -> None:
    with pytest.raises(ValidationError, match="code and coding scheme"):
        SourceNativeLabel(
            name="diagnosis",
            value="example",
            code="123",
            coding_scheme=None,
            coding_scheme_version=None,
            provenance="source field",
        )


def test_validation_reports_cross_reference_and_missing_asset_errors(tmp_path: Path) -> None:
    source = load_registry(PROJECT_DIR)
    collection = source.collections["cptac-coad-idc"].model_copy(
        update={"subsets": ["missing-subset"]}
    )
    broken = source.model_copy(
        update={"collections": {**source.collections, collection.collection_id: collection}}
    )
    broken_issues = validate_registry(broken, require_assets=False)
    assert any("unknown subset" in issue for issue in broken_issues)

    shutil.copy2(PROJECT_DIR / "registry.json", tmp_path / "registry.json")
    for relative_path in (
        source.index.collections
        + source.index.subsets
        + source.index.asset_manifests
        + source.index.slide_records
    ):
        destination = tmp_path / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(PROJECT_DIR / relative_path, destination)
    unmaterialized = load_registry(tmp_path)
    subset = next(iter(unmaterialized.subsets.values()))
    first_asset = next(iter(unmaterialized.asset_manifests.values())).assets[0]
    linked_asset = tmp_path / subset.asset_root / first_asset.relative_path
    linked_asset.parent.mkdir(parents=True, exist_ok=True)
    linked_asset.symlink_to(PROJECT_DIR / subset.asset_root / first_asset.relative_path)
    missing = validate_registry(unmaterialized, require_assets=True)
    assert any("must not be a symbolic link" in issue for issue in missing)
    asset_count = sum(len(manifest.assets) for manifest in unmaterialized.asset_manifests.values())
    assert len([issue for issue in missing if "required source asset is missing" in issue]) == (
        asset_count - 1
    )


def test_validation_reports_unknown_slide_asset_without_crashing() -> None:
    source = load_registry(PROJECT_DIR)
    slide = next(iter(source.slides.values()))
    broken_slide = slide.model_copy(update={"asset_paths": [*slide.asset_paths, "unknown.dcm"]})
    broken = source.model_copy(
        update={"slides": {**source.slides, broken_slide.slide_id: broken_slide}}
    )

    issues = validate_registry(broken, require_assets=False)

    assert any("slide and asset paths differ" in issue for issue in issues)


def test_file_validation_reports_size_and_digest(tmp_path: Path) -> None:
    registry = load_registry(PROJECT_DIR)
    asset_manifest = registry.asset_manifests["cptac-coad-idc-v23-smallest-series-assets"]
    asset = asset_manifest.assets[0]
    path = tmp_path / asset.relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"not the source asset")

    issues = validate_file(path, asset)

    assert any("expected 795484 bytes" in issue for issue in issues)
    assert any("expected SHA-256" in issue for issue in issues)


def test_aperio_validation_checks_native_scanner_and_scale(tmp_path: Path) -> None:
    source = load_registry(PROJECT_DIR)
    slide = next(iter(source.slides.values()))
    path = tmp_path / "synthetic.svs"
    tifffile.imwrite(
        path,
        np.zeros((4, 5, 3), dtype=np.uint8),
        description=("Aperio Image Library|AppMag = 40|ScanScope ID = SS1302|MPP = 0.25"),
    )
    matching = slide.model_copy(
        update={
            "scanner": slide.scanner.model_copy(
                update={
                    "device_serial_number": "SS1302",
                    "objective_power": 40.0,
                }
            ),
            "physical_resolution": slide.physical_resolution.model_copy(
                update={
                    "micrometres_per_pixel_x": 0.25,
                    "micrometres_per_pixel_y": 0.25,
                    "total_pixel_matrix_columns": 5,
                    "total_pixel_matrix_rows": 4,
                }
            ),
        }
    )

    assert validate_aperio(path, matching) == []

    mismatched = matching.model_copy(
        update={
            "scanner": matching.scanner.model_copy(
                update={"device_serial_number": "OTHER", "objective_power": 20.0}
            ),
            "physical_resolution": matching.physical_resolution.model_copy(
                update={"micrometres_per_pixel_x": 0.5, "total_pixel_matrix_columns": 6}
            ),
        }
    )
    issues = validate_aperio(path, mismatched)
    assert any("ScanScope ID" in issue for issue in issues)
    assert any("AppMag" in issue for issue in issues)
    assert any("physical resolution" in issue for issue in issues)
    assert any("TIFF dimensions" in issue for issue in issues)

    path.write_bytes(b"not a TIFF")
    assert any("invalid Aperio TIFF" in issue for issue in validate_aperio(path, matching))
