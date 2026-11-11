import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from cptac_lscc_source.acquisition import AcquisitionError, _request, verify_live_releases
from cptac_lscc_source.models import SnapshotManifest, SourceContract
from cptac_lscc_source.product import ProductError, publish_product

PROJECT_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def published_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("published")
    (root / "contracts").symlink_to(PROJECT_DIR / "contracts", target_is_directory=True)
    (root / "snapshots").symlink_to(PROJECT_DIR / "snapshots", target_is_directory=True)
    publish_product(root)
    return root


def _jsonl(path: Path) -> list[dict[str, object]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def test_publish_preserves_repository_native_linkage(published_root: Path) -> None:
    metrics = json.loads((published_root / "outputs/metrics.json").read_text(encoding="utf-8"))
    participants = _jsonl(published_root / "outputs/native-index.jsonl")

    assert metrics["participant_count"] == 212
    assert metrics["tcia_slide_count"] == 1081
    assert metrics["pdc_study_count"] == 4
    assert metrics["pdc_clinical_record_count"] == 752
    assert metrics["pdc_artifact_count"] == 3915
    assert metrics["gdc_case_count"] == 108
    assert metrics["gdc_file_count"] == 6771
    assert metrics["gdc_files_by_access"] == {"controlled": 5128, "open": 1643}
    assert metrics["gdc_files_by_experimental_strategy"] == {
        "Methylation Array": 597,
        "RNA-Seq": 1836,
        "WGS": 1893,
        "WXS": 1836,
        "miRNA-Seq": 609,
    }
    assert len(participants) == 212
    assert {item["publisher_participant_id"] for item in participants} == {
        json.loads(line)["native"]["Case_ID"]
        for line in (PROJECT_DIR / "snapshots/tcia-slides.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    }


def test_artifact_index_is_metadata_only_and_keeps_access_and_checksums(
    published_root: Path,
) -> None:
    artifacts = _jsonl(published_root / "outputs/artifact-index.jsonl")
    tcia = [item for item in artifacts if item["repository"] == "TCIA"]
    pdc = [item for item in artifacts if item["repository"] == "PDC"]
    gdc = [item for item in artifacts if item["repository"] == "GDC"]

    assert len(tcia) == 1081
    assert len(pdc) == 3915
    assert len(gdc) == 6771
    assert {item["availability"] for item in artifacts} == {"metadata_only"}
    assert {item["assay"] for item in tcia} == {"H&E whole slide image"}
    assert {item["assay_evidence"] for item in tcia} == {
        "https://pdc.cancer.gov/pdc/cptac-pancancer"
    }
    assert all(
        "pathdb.cancerimagingarchive.net/node/" in str(item["locator"]) for item in tcia
    )
    assert all(item["checksum"] is None for item in tcia)
    assert all(item["missing_checksum_reason"] for item in tcia)
    assert any(item["checksum_algorithm"] == "md5" for item in pdc)
    assert {item["access_tier"] for item in gdc} == {"open", "controlled"}
    assert all(item["checksum_algorithm"] == "md5" for item in gdc)


def test_missingness_and_exact_specimen_links_are_explicit(published_root: Path) -> None:
    missingness = json.loads(
        (published_root / "outputs/missingness.json").read_text(encoding="utf-8")
    )
    participants = _jsonl(published_root / "outputs/native-index.jsonl")
    complete = next(
        item for item in participants if item["publisher_participant_id"] == "C3L-00081"
    )

    assert missingness["missing_participant_counts"] == {
        "gdc_case": 104,
        "gdc_genomic_file": 104,
        "pdc_proteomic_study": 102,
        "tcia_slide": 0,
    }
    assert complete["missingness"] == {
        "gdc_case": False,
        "gdc_genomic_file": False,
        "pdc_proteomic_study": False,
        "tcia_slide": False,
    }
    assert complete["pdc_clinical_refs"] == [
        "pdc:clinical:PDC000232:1c63ce99-d028-11ea-b1fd-0aad30af8a83",
        "pdc:clinical:PDC000234:1c63ce99-d028-11ea-b1fd-0aad30af8a83",
    ]
    assert complete["specimen_links"] == [
        {
            "gdc_sample_refs": ["gdc:sample:C3L-00081-01"],
            "match_method": "exact_submitter_id",
            "pdc_sample_refs": ["pdc:sample:C3L-00081-01"],
            "tcia_specimen_id": "C3L-00081-01",
        },
        {
            "gdc_sample_refs": ["gdc:sample:C3L-00081-06"],
            "match_method": "exact_submitter_id",
            "pdc_sample_refs": ["pdc:sample:C3L-00081-06"],
            "tcia_specimen_id": "C3L-00081-06",
        },
    ]


def test_source_product_has_no_downstream_pathologize_semantics(published_root: Path) -> None:
    serialized = (published_root / "outputs/native-index.jsonl").read_text(encoding="utf-8")
    forbidden = (
        '"biomarker_status"',
        '"partition"',
        '"pathologize"',
        '"source_role"',
        '"split"',
        '"target_label"',
    )
    assert not any(value in serialized.lower() for value in forbidden)


def test_publish_rejects_changed_snapshot(tmp_path: Path) -> None:
    (tmp_path / "contracts").symlink_to(PROJECT_DIR / "contracts", target_is_directory=True)
    snapshots = tmp_path / "snapshots"
    snapshots.mkdir()
    for source in (PROJECT_DIR / "snapshots").iterdir():
        if source.name == "gdc-status.json":
            (snapshots / source.name).write_text(
                source.read_text(encoding="utf-8") + "\n", encoding="utf-8"
            )
        else:
            (snapshots / source.name).symlink_to(source)

    with pytest.raises(ProductError, match="checksum differs"):
        publish_product(tmp_path)


def test_contract_forbids_artifact_bytes() -> None:
    payload = json.loads((PROJECT_DIR / "contracts/sources.json").read_text(encoding="utf-8"))
    payload["artifact_policy"]["commit_artifact_bytes"] = True

    with pytest.raises(ValidationError):
        SourceContract.model_validate(payload)


def test_metadata_client_rejects_non_official_host() -> None:
    with pytest.raises(AcquisitionError, match="not allowlisted"):
        _request("https://example.test/cptac")


def test_live_verification_detects_release_drift(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "cptac_lscc_source.acquisition._json_request",
        lambda url: (
            {"version_number": "16"}
            if "cancerimagingarchive" in url
            else {"data_release_version": {"major": 46, "minor": 0}}
        ),
    )
    monkeypatch.setattr(
        "cptac_lscc_source.acquisition._pdc_catalog",
        lambda _study_ids: (
            SnapshotManifest.model_validate_json(
                (PROJECT_DIR / "snapshots/snapshot-manifest.json").read_text(encoding="utf-8")
            ).pdc_versions,
            {},
        ),
    )

    with pytest.raises(AcquisitionError, match="TCIA collection version"):
        verify_live_releases(PROJECT_DIR)
