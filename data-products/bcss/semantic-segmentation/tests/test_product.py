import hashlib
import io
import json
from pathlib import Path
from typing import Any

import pytest

from bcss_source_data import acquisition
from bcss_source_data.acquisition import (
    HISTOMICSTK_ANNOTATION_PREFIX,
    _source_allowed,
    acquire_annotations,
    acquire_masks,
)
from bcss_source_data.product import ProductError, publish_product

PROJECT_DIR = Path(__file__).resolve().parents[1]


def _copy_contracts(root: Path) -> None:
    contracts = root / "contracts"
    contracts.mkdir()
    for name in ("ontology.json", "source.json"):
        (contracts / name).write_text(
            (PROJECT_DIR / "contracts" / name).read_text(encoding="utf-8"), encoding="utf-8"
        )


def _copy_records(root: Path) -> dict[str, Any]:
    records = root / "records"
    records.mkdir()
    payload = json.loads((PROJECT_DIR / "records/native-corpus.json").read_text(encoding="utf-8"))
    (records / "native-corpus.json").write_text(json.dumps(payload), encoding="utf-8")
    return payload


def _write_single_mask_corpus(root: Path, payload: bytes) -> Path:
    corpus = json.loads((PROJECT_DIR / "records/native-corpus.json").read_text(encoding="utf-8"))
    record = corpus["records"][0]
    record["mask"].update(
        {
            "file_id": 1,
            "name": "fixture.png",
            "url": "https://ndownloader.figshare.com/files/1",
            "bytes": len(payload),
            "digests": {
                "md5": hashlib.md5(payload).hexdigest(),  # noqa: S324 - source checksum.
                "sha256": hashlib.sha256(payload).hexdigest(),
            },
        }
    )
    corpus["records"] = [record]
    records = root / "records"
    records.mkdir()
    (records / "native-corpus.json").write_text(json.dumps(corpus), encoding="utf-8")
    return root / "data/raw/masks/fixture.png"


def _write_single_annotation_corpus(root: Path, payload: bytes) -> Path:
    corpus = json.loads((PROJECT_DIR / "records/native-corpus.json").read_text(encoding="utf-8"))
    record = corpus["records"][0]
    item_id = record["wsi"]["dsa_item_id"]
    record["annotations"].update(
        {
            "name": f"{item_id}.json",
            "url": f"{HISTOMICSTK_ANNOTATION_PREFIX}{item_id}",
            "bytes": len(payload),
            "digests": {
                "md5": hashlib.md5(payload).hexdigest(),  # noqa: S324 - source checksum.
                "sha256": hashlib.sha256(payload).hexdigest(),
            },
            "media_type": "application/json",
            "coordinate_space": "wsi_base_pixels",
        }
    )
    corpus["records"] = [record]
    records = root / "records"
    records.mkdir()
    (records / "native-corpus.json").write_text(json.dumps(corpus), encoding="utf-8")
    return root / f"data/raw/annotations/{item_id}.json"


def test_publish_preserves_native_records_ontology_and_lineage(tmp_path: Path) -> None:
    (tmp_path / "contracts").symlink_to(PROJECT_DIR / "contracts", target_is_directory=True)
    (tmp_path / "records").symlink_to(PROJECT_DIR / "records", target_is_directory=True)

    metrics = publish_product(tmp_path)

    assert metrics == {
        "annotation_artifact_count": 151,
        "annotation_bytes": 3_287_512_044,
        "dataset_id": "bcss-figshare-7193138-v2",
        "gdc_resolved_wsi_count": 150,
        "gdc_unresolved_wsi_count": 1,
        "mask_bytes": 28_404_662,
        "mask_count": 151,
        "native_code_count": 22,
        "native_ignore_codes": [0, 7],
        "patient_count": 151,
        "published_microns_per_pixel": 0.25,
        "record_count": 151,
        "record_level_publisher_role_count": 0,
        "scan_magnification_counts": {"20.0": 14, "40.0": 137},
        "slide_count": 151,
    }
    published = json.loads((tmp_path / "outputs/native-corpus.json").read_text(encoding="utf-8"))
    first = published["records"][0]
    assert first["patient_id"] == "TCGA-A1-A0SK"
    assert first["roi"] == {
        "coordinate_space": "wsi_base_pixels",
        "xmax": 49789,
        "xmin": 45749,
        "ymax": 27991,
        "ymin": 25055,
    }
    assert first["image_extraction"]["microns_per_pixel"] == 0.25
    assert first["publisher_roles"] == []
    assert first["annotations"] == {
        "bytes": 3_585_731,
        "coordinate_space": "wsi_base_pixels",
        "digests": {
            "md5": "01ef1a068cdea76a2a0c8303e9dd704e",
            "sha256": "f93b1dbd4f98d055a18a6691ee2a97c297d980d7fa7d57485a3a368d8aecc281",
        },
        "media_type": "application/json",
        "name": "5bbdeed1e629140048d01bcb.json",
        "url": "https://demo.kitware.com/histomicstk/api/v1/annotation/item/5bbdeed1e629140048d01bcb",
    }
    assert published["provenance"]["dsa_snapshot_date"] == "2026-11-11"
    source = json.loads((PROJECT_DIR / "contracts/source.json").read_text(encoding="utf-8"))
    assert source["source_image_semantics"] == {
        "annotation_media_type": "application/json",
        "evidence_url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC6748796/",
        "mask_media_type": "image/png",
        "roi_media_type": "image/png",
        "source_project": "TCGA-BRCA",
        "stain": "hematoxylin_and_eosin",
    }
    ontology = json.loads((tmp_path / "outputs/native-ontology.json").read_text(encoding="utf-8"))
    assert [item["code"] for item in ontology["codes"]] == list(range(22))


def test_publish_rejects_changed_native_ontology(tmp_path: Path) -> None:
    _copy_contracts(tmp_path)
    _copy_records(tmp_path)
    ontology_path = tmp_path / "contracts/ontology.json"
    ontology = json.loads(ontology_path.read_text(encoding="utf-8"))
    ontology["codes"][7]["source_use"] = "class"
    ontology_path.write_text(json.dumps(ontology), encoding="utf-8")

    with pytest.raises(ProductError, match="native ignore codes"):
        publish_product(tmp_path)


def test_publish_rejects_invented_record_role(tmp_path: Path) -> None:
    _copy_contracts(tmp_path)
    corpus = _copy_records(tmp_path)
    corpus["records"][0]["publisher_roles"] = ["core_train"]
    (tmp_path / "records/native-corpus.json").write_text(json.dumps(corpus), encoding="utf-8")

    with pytest.raises(ProductError, match="role assignments were not released"):
        publish_product(tmp_path)


def test_publish_rejects_duplicate_patient_identity(tmp_path: Path) -> None:
    _copy_contracts(tmp_path)
    corpus = _copy_records(tmp_path)
    corpus["records"][1]["patient_id"] = corpus["records"][0]["patient_id"]
    (tmp_path / "records/native-corpus.json").write_text(json.dumps(corpus), encoding="utf-8")

    with pytest.raises(ProductError, match="patient identities must be unique"):
        publish_product(tmp_path)


def test_publish_rejects_untracked_gdc_gap(tmp_path: Path) -> None:
    _copy_contracts(tmp_path)
    corpus = _copy_records(tmp_path)
    corpus["provenance"]["unresolved_gdc_wsi_names"] = []
    (tmp_path / "records/native-corpus.json").write_text(json.dumps(corpus), encoding="utf-8")

    with pytest.raises(ProductError, match="unresolved GDC identities"):
        publish_product(tmp_path)


def test_source_allowlist_requires_exact_figshare_https_path() -> None:
    assert _source_allowed("https://ndownloader.figshare.com/files/13243676")
    assert not _source_allowed("http://ndownloader.figshare.com/files/13243676")
    assert not _source_allowed("https://ndownloader.figshare.com/other/13243676")
    assert not _source_allowed("https://attacker.example/files/13243676")
    assert _source_allowed(
        f"{HISTOMICSTK_ANNOTATION_PREFIX}5bbdeed1e629140048d01bcb",
        HISTOMICSTK_ANNOTATION_PREFIX,
    )
    assert not _source_allowed(
        "https://demo.kitware.com/api/v1/annotation/item/5bbdeed1e629140048d01bcb",
        HISTOMICSTK_ANNOTATION_PREFIX,
    )


def test_acquisition_refuses_smaller_byte_budget() -> None:
    with pytest.raises(ProductError, match="limit"):
        acquire_masks(PROJECT_DIR, max_bytes=1)
    with pytest.raises(ProductError, match="limit"):
        acquire_annotations(PROJECT_DIR, max_bytes=1)


def test_acquisition_downloads_verifies_and_reuses_mask(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = b"indexed PNG fixture"
    destination = _write_single_mask_corpus(tmp_path, payload)
    monkeypatch.setattr(acquisition, "urlopen", lambda _request, **_kwargs: io.BytesIO(payload))

    assert acquire_masks(tmp_path, max_bytes=len(payload)) == 1
    assert destination.read_bytes() == payload

    monkeypatch.setattr(
        acquisition,
        "urlopen",
        lambda _request, **_kwargs: pytest.fail("verified mask should be reused"),
    )
    assert acquire_masks(tmp_path, max_bytes=len(payload)) == 0


def test_acquisition_removes_corrupt_partial(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    expected = b"expected"
    destination = _write_single_mask_corpus(tmp_path, expected)
    monkeypatch.setattr(acquisition, "urlopen", lambda _request, **_kwargs: io.BytesIO(b"corrupt!"))

    with pytest.raises(ProductError, match="downloaded mask differs"):
        acquire_masks(tmp_path, max_bytes=len(expected))

    assert not destination.exists()
    assert not destination.with_name(f".{destination.name}.part").exists()


def test_acquisition_stops_at_pinned_byte_count(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    expected = b"expected"
    destination = _write_single_mask_corpus(tmp_path, expected)
    monkeypatch.setattr(
        acquisition, "urlopen", lambda _request, **_kwargs: io.BytesIO(b"too many bytes")
    )

    with pytest.raises(ProductError, match="exceeds pinned byte count"):
        acquire_masks(tmp_path, max_bytes=len(expected))

    assert not destination.exists()
    assert not destination.with_name(f".{destination.name}.part").exists()


def test_acquisition_rejects_non_allowlisted_record(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = b"fixture"
    _write_single_mask_corpus(tmp_path, payload)
    path = tmp_path / "records/native-corpus.json"
    corpus = json.loads(path.read_text(encoding="utf-8"))
    corpus["records"][0]["mask"]["url"] = "https://attacker.example/files/1"
    path.write_text(json.dumps(corpus), encoding="utf-8")
    monkeypatch.setattr(
        acquisition,
        "urlopen",
        lambda _request, **_kwargs: pytest.fail("non-allowlisted URL must not be opened"),
    )

    with pytest.raises(ProductError, match="does not match its Figshare identity"):
        acquire_masks(tmp_path, max_bytes=len(payload))


def test_acquisition_downloads_verifies_and_reuses_annotation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = b'[{"annotation":{"name":"native fixture"}}]'
    destination = _write_single_annotation_corpus(tmp_path, payload)
    monkeypatch.setattr(acquisition, "urlopen", lambda _request, **_kwargs: io.BytesIO(payload))

    assert acquire_annotations(tmp_path, max_bytes=len(payload)) == 1
    assert destination.read_bytes() == payload

    monkeypatch.setattr(
        acquisition,
        "urlopen",
        lambda _request, **_kwargs: pytest.fail("verified annotation should be reused"),
    )
    assert acquire_annotations(tmp_path, max_bytes=len(payload)) == 0


def test_acquisition_rejects_non_allowlisted_annotation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = b"[]"
    _write_single_annotation_corpus(tmp_path, payload)
    path = tmp_path / "records/native-corpus.json"
    corpus = json.loads(path.read_text(encoding="utf-8"))
    corpus["records"][0]["annotations"]["url"] = "https://attacker.example/annotations/1"
    path.write_text(json.dumps(corpus), encoding="utf-8")
    monkeypatch.setattr(
        acquisition,
        "urlopen",
        lambda _request, **_kwargs: pytest.fail("non-allowlisted URL must not be opened"),
    )

    with pytest.raises(ProductError, match="does not match its DSA identity"):
        acquire_annotations(tmp_path, max_bytes=len(payload))
