import hashlib
import json
from pathlib import Path

import pytest

from panda_source_data.models import ArtifactReference, SourceManifest
from panda_source_data.source import (
    SourceDataError,
    index_native_release,
    load_manifest,
    publish_contract,
)

PROJECT_DIR = Path(__file__).resolve().parents[1]


def _copy_contract(root: Path) -> None:
    (root / "evidence").mkdir(parents=True)
    manifest = json.loads((PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"))
    for source in manifest["source_records"]:
        name = Path(source["snapshot_path"]).name
        value = (PROJECT_DIR / source["snapshot_path"]).read_bytes()
        (root / "evidence" / name).write_bytes(value)
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def _write_fixture(root: Path, *, duplicate: bool = False, invalid_provider: bool = False) -> Path:
    _copy_contract(root)
    native = root / "data/native"
    (native / "train_images").mkdir(parents=True)
    (native / "train_label_masks").mkdir()
    rows = [
        "image_id,data_provider,isup_grade,gleason_score",
        "slide-a,radboud,2,3+4",
        f"slide-{'a' if duplicate else 'b'},"
        f"{'unknown' if invalid_provider else 'karolinska'},0,negative",
    ]
    train_csv = native / "train.csv"
    train_csv.write_text("\n".join(rows) + "\n", encoding="utf-8")
    (native / "train_images/slide-a.tiff").write_bytes(b"radboud-slide")
    (native / "train_label_masks/slide-a_mask.tiff").write_bytes(b"radboud-mask")
    if not duplicate:
        (native / "train_images/slide-b.tiff").write_bytes(b"karolinska-slide")
    return train_csv


def test_publish_contract_verifies_snapshots_without_credentials(tmp_path: Path) -> None:
    _copy_contract(tmp_path)

    metrics = publish_contract(tmp_path)

    assert metrics["development_slide_count"] == 10616
    assert metrics["development_mask_count"] == 10516
    assert metrics["provider_slide_counts"] == {"karolinska": 5456, "radboud": 5160}
    contract = json.loads((tmp_path / "outputs/source-contract.json").read_text())
    assert contract["access"]["authentication_required"] is True
    assert contract["rights"]["spdx_id"] == "CC-BY-NC-SA-4.0"
    references = json.loads((tmp_path / "outputs/artifact-reference-contract.json").read_text())
    assert references["record_reference_template"] == "panda:{image_id}"


def test_manifest_preserves_provider_mask_scale_and_label_caveats() -> None:
    manifest = load_manifest(PROJECT_DIR)
    providers = {item.provider_id: item for item in manifest.providers}

    assert providers["radboud"].mask_codes[5] == ("cancerous epithelium (Gleason pattern 5)")
    assert set(providers["radboud"].mask_codes) == set(range(6))
    assert set(providers["karolinska"].mask_codes) == set(range(3))
    assert providers["radboud"].published_tiff_micrometres_per_pixel == [0.48]
    assert providers["karolinska"].scanner_vendors == ["Hamamatsu", "Aperio"]
    assert any("label noise" in caveat for caveat in manifest.labels.caveats)
    assert manifest.identities.patient_identity_available_in_distribution is False


def test_private_index_preserves_native_labels_roles_and_artifacts(tmp_path: Path) -> None:
    train_csv = _write_fixture(tmp_path)

    metrics = index_native_release(
        tmp_path,
        metadata_path=train_csv,
        output_root=tmp_path / "private",
        require_complete=False,
    )

    assert metrics["record_count"] == 2
    assert metrics["mask_count"] == 1
    assert metrics["artifact_count"] == 3
    assert metrics["provider_slide_counts"] == {"karolinska": 1, "radboud": 1}
    assert metrics["train_csv_sha256"] == hashlib.sha256(train_csv.read_bytes()).hexdigest()
    records = [
        json.loads(line)
        for line in (tmp_path / "private/native-index.jsonl").read_text().splitlines()
    ]
    radboud, karolinska = records
    assert radboud["record_ref"] == "panda:slide-a"
    assert radboud["patient_id"] is None
    assert radboud["case_id"] is None
    assert radboud["publisher_role"] == "train"
    assert radboud["gleason_score"] == "3+4"
    assert radboud["isup_grade"] == 2
    assert radboud["mask_annotation"]["available"] is True
    assert radboud["mask_annotation"]["native_codes"]["5"].endswith("pattern 5)")
    assert karolinska["mask_annotation"]["available"] is False
    assert karolinska["mask_annotation"]["native_codes"]["2"].startswith("cancerous tissue")
    artifacts = [
        json.loads(line)
        for line in (tmp_path / "private/artifact-references.jsonl").read_text().splitlines()
    ]
    assert artifacts[0]["artifact_ref"] == "panda:slide-a:whole_slide"
    assert artifacts[0]["original_reference"].endswith("train_images/slide-a.tiff")
    assert len(artifacts[0]["sha256"]) == 64


def test_index_rejects_duplicate_image_identity(tmp_path: Path) -> None:
    train_csv = _write_fixture(tmp_path, duplicate=True)

    with pytest.raises(SourceDataError, match="image_id values must be unique"):
        index_native_release(tmp_path, metadata_path=train_csv, require_complete=False)


def test_index_rejects_unknown_provider(tmp_path: Path) -> None:
    train_csv = _write_fixture(tmp_path, invalid_provider=True)

    with pytest.raises(SourceDataError, match="invalid PANDA image or provider identity"):
        index_native_release(tmp_path, metadata_path=train_csv, require_complete=False)


def test_complete_index_requires_full_release(tmp_path: Path) -> None:
    train_csv = _write_fixture(tmp_path)

    with pytest.raises(SourceDataError, match="10,616-slide release"):
        index_native_release(tmp_path, metadata_path=train_csv)


def test_publish_rejects_changed_official_record_snapshot(tmp_path: Path) -> None:
    _copy_contract(tmp_path)
    (tmp_path / "evidence/kaggle.json").write_text("{}\n", encoding="utf-8")

    with pytest.raises(SourceDataError, match="official record snapshot changed"):
        publish_contract(tmp_path)


def test_source_contract_rejects_collapsed_mask_domain() -> None:
    payload = json.loads((PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"))
    payload["providers"][0]["mask_codes"].pop("5")

    with pytest.raises(ValueError, match="mask codes differ"):
        SourceManifest.model_validate(payload)


def test_artifact_reference_rejects_parent_path() -> None:
    with pytest.raises(ValueError, match="normalized relative paths"):
        ArtifactReference(
            dataset_id="panda-prostate-cancer-grade-assessment-2020",
            artifact_ref="panda:slide:whole_slide",
            image_id="slide",
            kind="whole_slide",
            publisher_path="../slide.tiff",
            original_reference=(
                "kaggle://competitions/prostate-cancer-grade-assessment/train_images/slide.tiff"
            ),
            local_path="data/native/train_images/slide.tiff",
            bytes=1,
            sha256="0" * 64,
            format="multi-level TIFF",
        )
