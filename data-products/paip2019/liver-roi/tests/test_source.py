import json
from pathlib import Path

import pytest
import tifffile

from paip2019_source_data.models import NativeCaseReceipt, SourceManifest
from paip2019_source_data.source import SourceDataError, index_native_release, publish_contract

PROJECT_DIR = Path(__file__).resolve().parents[1]


def _copy_manifest(root: Path) -> None:
    (root / "manifest.json").write_text(
        (PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"), encoding="utf-8"
    )


def _write_tiff(path: Path, *, description: str | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tifffile.imwrite(path, [[0, 1], [1, 0]], description=description)


def _write_training_fixture(root: Path, *, negative_pen: bool = True) -> Path:
    _copy_manifest(root)
    _write_tiff(
        root / "data/native/case-01/slide.svs",
        description="Aperio Image Library|AppMag = 20|MPP = 0.5|",
    )
    _write_tiff(root / "data/native/case-01/whole.tif")
    _write_tiff(root / "data/native/case-01/viable.tif")
    negative = '<Region Id="3" NegativeROA="1"><Vertices /></Region>' if negative_pen else ""
    xml = (
        "<Annotations>"
        '<Annotation Id="1"><Regions><Region Id="1" NegativeROA="0"><Vertices /></Region>'
        "</Regions></Annotation>"
        '<Annotation Id="2"><Regions><Region Id="2" NegativeROA="0"><Vertices /></Region>'
        f"{negative}</Regions></Annotation>"
        "</Annotations>"
    )
    (root / "data/native/case-01/regions.xml").write_text(xml, encoding="utf-8")
    receipt = {
        "schema_version": "1.0.0",
        "case_id": "case-01",
        "slide_id": "slide-01",
        "source_role": "training",
        "institution_id": None,
        "slide_path": "data/native/case-01/slide.svs",
        "xml_annotation_path": "data/native/case-01/regions.xml",
        "whole_tumor_mask_path": "data/native/case-01/whole.tif",
        "viable_tumor_mask_path": "data/native/case-01/viable.tif",
        "publisher_measurements": {
            "whole_tumor_area_mm2": 10.0,
            "viable_tumor_area_mm2": 2.5,
            "viable_tumor_burden_percent": 25.0,
        },
    }
    path = root / "data/native/source-receipt.jsonl"
    path.write_text(json.dumps(receipt) + "\n", encoding="utf-8")
    return path


def test_publish_contract_is_metadata_only(tmp_path: Path) -> None:
    _copy_manifest(tmp_path)

    metrics = publish_contract(tmp_path)

    assert metrics["case_count"] == 100
    assert metrics["publisher_role_counts"] == {"training": 50, "validation": 10, "test": 40}
    contract = json.loads((tmp_path / "outputs/source-contract.json").read_text(encoding="utf-8"))
    assert contract["access"]["policy"] == "manual_dua_approval"
    assert contract["access"]["dua"]["bytes"] == 26721
    assert contract["access"]["dua"]["sha256"] == (
        "2019706cac6800c4dd26d3525f39d5f5d87d4b8d9aaab187be9bd40142f91cad"
    )
    assert contract["rights"]["dataset"]["spdx_id"] == "CC-BY-NC-4.0"
    assert contract["rights"]["publication"]["spdx_id"] == "CC-BY-NC-ND-4.0"


def test_manifest_preserves_publisher_regions_roles_and_scale() -> None:
    manifest = SourceManifest.model_validate_json(
        (PROJECT_DIR / "manifest.json").read_text(encoding="utf-8")
    )

    assert manifest.imaging.micrometres_per_pixel is None
    assert manifest.imaging.nominal_magnification == 20
    assert {item.name for item in manifest.annotations.regions} == {
        "whole_tumor_area",
        "viable_tumor_area",
        "negative_pen_region",
    }
    assert {item.role: item.case_count for item in manifest.publisher_roles} == {
        "training": 50,
        "validation": 10,
        "test": 40,
    }


def test_private_index_keeps_native_artifacts_coordinates_and_checksums(tmp_path: Path) -> None:
    receipt = _write_training_fixture(tmp_path)

    metrics = index_native_release(
        tmp_path,
        receipt_path=receipt,
        output_root=tmp_path / "private-output",
        require_complete=False,
    )

    assert metrics["artifact_counts"] == {
        "viable_tumor_mask": 1,
        "whole_slide": 1,
        "whole_tumor_mask": 1,
        "xml_annotation": 1,
    }
    record = json.loads(
        (tmp_path / "private-output/native-index.jsonl").read_text(encoding="utf-8")
    )
    assert record["record_ref"] == "paip2019:case-01"
    assert record["source_role"] == "training"
    assert record["slide_scale"]["micrometres_per_pixel_x"] == 0.5
    assert record["xml_regions"] == {
        "coordinate_frame": "aperio_imagescope_slide_coordinates",
        "negative_pen_region": 1,
        "viable_tumor_area": 1,
        "whole_tumor_area": 1,
    }
    artifacts = {item["kind"]: item for item in record["artifacts"]}
    assert artifacts["whole_slide"]["geometry"]["coordinate_frame"] == ("aperio_svs_level_0_pixels")
    assert artifacts["whole_tumor_mask"]["geometry"]["coordinate_frame"] == (
        "publisher_binary_mask_raster"
    )
    assert len(artifacts["xml_annotation"]["sha256"]) == 64


def test_training_receipt_requires_both_masks_and_measurements() -> None:
    with pytest.raises(ValueError, match="training cases require"):
        NativeCaseReceipt(
            case_id="case",
            slide_id="slide",
            source_role="training",
            institution_id=None,
            slide_path="data/native/slide.svs",
        )


def test_held_out_receipt_rejects_ground_truth() -> None:
    with pytest.raises(ValueError, match="must not expose"):
        NativeCaseReceipt(
            case_id="case",
            slide_id="slide",
            source_role="test",
            institution_id=None,
            slide_path="data/native/slide.svs",
            xml_annotation_path="data/native/regions.xml",
        )


def test_index_rejects_incomplete_role_counts(tmp_path: Path) -> None:
    receipt = _write_training_fixture(tmp_path)

    with pytest.raises(SourceDataError, match="50/10/40"):
        index_native_release(tmp_path, receipt_path=receipt)


def test_index_rejects_missing_native_region(tmp_path: Path) -> None:
    receipt = _write_training_fixture(tmp_path, negative_pen=False)
    xml_path = tmp_path / "data/native/case-01/regions.xml"
    xml_path.write_text(
        '<Annotations><Annotation Id="1"><Regions><Region NegativeROA="0" /></Regions>'
        "</Annotation></Annotations>",
        encoding="utf-8",
    )

    with pytest.raises(SourceDataError, match="lacks whole-tumour or viable-tumour"):
        index_native_release(tmp_path, receipt_path=receipt, require_complete=False)
