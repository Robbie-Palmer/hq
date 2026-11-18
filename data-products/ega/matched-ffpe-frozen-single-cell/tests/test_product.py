import io
import json
import shutil
import urllib.request
from http.client import HTTPMessage
from pathlib import Path

import pytest

from ega_matched_single_cell import product
from ega_matched_single_cell.models import SourceContract
from ega_matched_single_cell.product import (
    ProductError,
    _fetch_public_json,
    _PublicMetadataRedirectHandler,
    build_product,
    check_public_drift,
)

PROJECT_DIR = Path(__file__).resolve().parents[1]


def _linked_product(tmp_path: Path) -> None:
    (tmp_path / "contracts").symlink_to(PROJECT_DIR / "contracts", target_is_directory=True)
    fixtures = tmp_path / "tests/fixtures"
    fixtures.mkdir(parents=True)
    (fixtures / "ega-public-metadata").symlink_to(
        PROJECT_DIR / "tests/fixtures/ega-public-metadata", target_is_directory=True
    )


def _mutable_product(tmp_path: Path) -> Path:
    shutil.copytree(PROJECT_DIR / "contracts", tmp_path / "contracts")
    destination = tmp_path / "tests/fixtures/ega-public-metadata"
    destination.parent.mkdir(parents=True)
    shutil.copytree(PROJECT_DIR / "tests/fixtures/ega-public-metadata", destination)
    return destination


def test_build_preserves_access_counts_pairs_checksums_and_missingness(tmp_path: Path) -> None:
    _linked_product(tmp_path)

    metrics = build_product(tmp_path)

    assert metrics == {
        "controlled_payload_download_count": 0,
        "experiment_count": 35,
        "file_count": 241,
        "file_total_bytes": 965_526_724_986,
        "paper_patient_count": 7,
        "paper_specimen_pair_count": 12,
        "portal_displayed_sample_count": 4,
        "public_sample_record_count": 24,
        "run_count": 107,
        "checksum_counts": {"MD5": 241},
        "experiment_model_counts": {
            "Illumina NovaSeq 6000": 10,
            "Illumina NovaSeq X Plus": 25,
        },
        "experiment_strategy_counts": {"ATAC-seq": 12, "RNA-Seq": 23},
    }
    inventory = json.loads((tmp_path / "outputs/source-inventory.json").read_text(encoding="utf-8"))
    assert inventory["dataset"]["access_type"] == "controlled"
    assert inventory["dataset"]["released_date"].startswith("2025-11-21")
    assert len(inventory["sample_pairs"]) == 12
    assert {pair["frozen_preparation_code"] for pair in inventory["sample_pairs"]} == {
        "FF",
        "OCT",
    }
    assert inventory["files"][0]["accession_id"] == "EGAF00008978622"
    assert len(inventory["files"][0]["unencrypted_checksum"]) == 32
    assert inventory["missingness"]["ffpe_sample_subject_id_null_count"] == 12
    assert inventory["missingness"]["samples_without_public_runs"] == ["EGAN00004810945"]
    assert inventory["missingness"]["payload"] == "not downloaded; controlled access"
    assert inventory["evidence"]["repository_payload_rights"] == (
        "no public redistribution license declared"
    )
    assert {tier["tier"] for tier in inventory["evidence"]["access_tiers"]} == {
        "public_metadata",
        "approved_accessor_metadata",
        "controlled_payload",
    }
    assert {role["object_type"] for role in inventory["evidence"]["source_object_roles"]} == {
        "dataset",
        "study",
        "policy",
        "dac",
        "sample",
        "experiment",
        "run",
        "file",
        "paper",
    }


def test_default_build_never_fetches_network_metadata(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _linked_product(tmp_path)
    monkeypatch.setattr(
        product,
        "_fetch_public_json",
        lambda _endpoint: pytest.fail("default metadata build must remain offline"),
    )

    assert build_product(tmp_path)["controlled_payload_download_count"] == 0


def test_build_rejects_portal_sample_count_drift(tmp_path: Path) -> None:
    fixtures = _mutable_product(tmp_path)
    dataset_path = fixtures / "dataset.json"
    dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
    dataset["num_samples"] = 24
    dataset_path.write_text(json.dumps(dataset), encoding="utf-8")

    with pytest.raises(ValueError, match="Input should be 4"):
        build_product(tmp_path)


def test_build_rejects_incomplete_publisher_pair(tmp_path: Path) -> None:
    fixtures = _mutable_product(tmp_path)
    samples_path = fixtures / "samples.json"
    samples = json.loads(samples_path.read_text(encoding="utf-8"))
    samples.pop()
    samples_path.write_text(json.dumps(samples), encoding="utf-8")

    with pytest.raises(ProductError, match="incomplete publisher sample pair"):
        build_product(tmp_path)


def test_build_rejects_file_byte_drift(tmp_path: Path) -> None:
    fixtures = _mutable_product(tmp_path)
    files_path = fixtures / "files.json"
    files = json.loads(files_path.read_text(encoding="utf-8"))
    files[0]["filesize"] += 1
    files_path.write_text(json.dumps(files), encoding="utf-8")

    with pytest.raises(ProductError, match="file bytes changed"):
        build_product(tmp_path)


def test_build_rejects_duplicate_file_identity(tmp_path: Path) -> None:
    fixtures = _mutable_product(tmp_path)
    files_path = fixtures / "files.json"
    files = json.loads(files_path.read_text(encoding="utf-8"))
    files[-1]["accession_id"] = files[0]["accession_id"]
    files_path.write_text(json.dumps(files), encoding="utf-8")

    with pytest.raises(ProductError, match="duplicate file accession"):
        build_product(tmp_path)


def test_contract_requires_every_publisher_output_domain() -> None:
    payload = json.loads(
        (PROJECT_DIR / "contracts/source-product.json").read_text(encoding="utf-8")
    )
    payload["paper"]["publisher_outputs"].pop()

    with pytest.raises(ValueError, match="all supported evidence domains"):
        SourceContract.model_validate(payload)


def test_public_drift_check_uses_local_fixtures_without_rewriting(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _linked_product(tmp_path)
    fixtures = PROJECT_DIR / "tests/fixtures/ega-public-metadata"
    responses = {
        endpoint: json.loads((fixtures / name).read_text(encoding="utf-8"))
        for name, endpoint in product.FIXTURE_ENDPOINTS.items()
    }
    monkeypatch.setattr(product, "_fetch_public_json", responses.__getitem__)

    checked = check_public_drift(tmp_path)

    assert len(checked) == 8
    assert checked["files.json"].endswith("/files")
    assert not (tmp_path / "outputs").exists()


def test_public_drift_check_reports_changed_endpoint(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _linked_product(tmp_path)
    fixtures = PROJECT_DIR / "tests/fixtures/ega-public-metadata"
    responses = {
        endpoint: json.loads((fixtures / name).read_text(encoding="utf-8"))
        for name, endpoint in product.FIXTURE_ENDPOINTS.items()
    }
    responses["/datasets/EGAD00001015781"]["num_samples"] = 5
    monkeypatch.setattr(product, "_fetch_public_json", responses.__getitem__)

    with pytest.raises(ProductError, match=r"dataset\.json"):
        check_public_drift(tmp_path)


def test_public_fetch_rejects_parameters() -> None:
    with pytest.raises(ProductError, match="without parameters"):
        _fetch_public_json("/datasets/EGAD00001015781?token=forbidden")


def test_public_fetch_sends_no_authorization_header(monkeypatch: pytest.MonkeyPatch) -> None:
    url = "https://metadata.ega-archive.org/datasets/EGAD00001015781"

    class FakeResponse(io.BytesIO):
        def geturl(self) -> str:
            return url

    class FakeOpener:
        def open(self, request: urllib.request.Request, timeout: int) -> FakeResponse:
            assert timeout == 30
            assert request.full_url == url
            headers = dict(request.header_items())
            assert set(headers) == {"Accept", "User-agent"}
            assert "Authorization" not in headers
            return FakeResponse(b'{"accession_id":"EGAD00001015781"}')

    monkeypatch.setattr(urllib.request, "build_opener", lambda *_handlers: FakeOpener())

    assert _fetch_public_json("/datasets/EGAD00001015781") == {"accession_id": "EGAD00001015781"}


def test_redirect_handler_rejects_a_different_origin() -> None:
    handler = _PublicMetadataRedirectHandler()

    with pytest.raises(ProductError, match="left the allowlisted EGA origin"):
        handler.redirect_request(
            urllib.request.Request("https://metadata.ega-archive.org/datasets/id"),
            io.BytesIO(),
            302,
            "Found",
            HTTPMessage(),
            "https://example.test/datasets/id",
        )
