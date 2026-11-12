from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import pytest
from data_artifacts.acquisition import RemoteFile
from pydantic import ValidationError

from pxd064700_source import acquisition
from pxd064700_source.acquisition import (
    ANNOUNCEMENT_URL,
    DIRECTORY_URL,
    FTP_DIR,
    FTP_HOST,
    AcquisitionError,
    _request,
    refresh_snapshots,
    verify_live_identity,
)
from pxd064700_source.models import SourceContract
from pxd064700_source.product import ProductError, publish_product

PROJECT_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def published_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("published")
    (root / "contracts").symlink_to(PROJECT_DIR / "contracts", target_is_directory=True)
    (root / "snapshots").symlink_to(PROJECT_DIR / "snapshots", target_is_directory=True)
    publish_product(root)
    return root


def _json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def test_release_inventory_is_exact_and_metadata_only(published_root: Path) -> None:
    metrics = _json(published_root / "outputs/metrics.json")
    artifacts = _jsonl(published_root / "outputs/artifact-index.jsonl")

    assert metrics == {
        "announced_artifact_count": 551,
        "artifact_count": 552,
        "artifacts_by_announcement_category": {
            "Associated file URI": 272,
            "Associated raw file URI": 269,
            "Other type file URI": 4,
            "Search engine output file URI": 6,
            "not_in_revision_1_announcement": 1,
        },
        "artifacts_by_native_role": {
            "DIA-NN binary spectral library": 1,
            "DIA-NN gene-group quantity matrix": 1,
            "DIA-NN precursor and peptide quantity matrix": 1,
            "DIA-NN protein, peptide, and precursor report": 1,
            "DIA-NN protein-group quantity matrix": 1,
            "DIA-NN run quality-control statistics": 1,
            "DIA-NN search log and parameters": 1,
            "DIA-NN spectral library table": 1,
            "DIA-NN unique-gene quantity matrix": 1,
            "Orbitrap raw DIA run": 269,
            "community sample and assay metadata": 1,
            "experiment and software overview": 1,
            "human protein sequence database": 1,
            "paper-case to body-donor map": 1,
            "publisher SHA-1 manifest": 1,
            "raw-run quantification sidecar": 269,
        },
        "checksummed_artifact_count": 550,
        "comparison_design_missing_run_count": 3,
        "donor_count": 8,
        "files_with_naming_variants": 83,
        "pairing_unit_count": 48,
        "product_id": "proteomexchange-pxd064700-revision-1",
        "quant_sidecar_count": 269,
        "run_count": 269,
        "runs_by_preparation": {"FFPE": 69, "FFPE-Kit": 32, "Form": 96, "Fresh": 72},
        "total_listed_bytes": 710900159141,
        "total_listed_gib": 662.077367,
    }
    assert {item["availability"] for item in artifacts} == {"metadata_reference_only"}
    locators = [urlsplit(str(item["locator"])) for item in artifacts]
    assert all(
        locator.scheme == "ftp"
        and locator.hostname == FTP_HOST
        and locator.port is None
        and locator.username is None
        and locator.password is None
        and locator.path.startswith(f"{FTP_DIR}/")
        for locator in locators
    )
    assert len({item["artifact_ref"] for item in artifacts}) == 552


def test_checksums_and_announcement_gaps_are_explicit(published_root: Path) -> None:
    artifacts = _jsonl(published_root / "outputs/artifact-index.jsonl")
    missing = [item for item in artifacts if item["sha1"] is None]

    assert {item["file_name"] for item in missing} == {
        "PXD064700_community_annotated.sdrf.tsv",
        "checksum.txt",
    }
    assert sum(item["sha1"] is not None for item in artifacts) == 550
    assert all(item["checksum_basename_matches_listing"] for item in artifacts if item["sha1"])
    sdrf = next(
        item for item in artifacts if item["file_name"] == "PXD064700_community_annotated.sdrf.tsv"
    )
    assert sdrf["announcement_file_id"] is None
    assert "added after revision 1" in str(sdrf["missing_checksum_reason"])


def test_runs_preserve_native_preparation_and_assay_identity(published_root: Path) -> None:
    runs = _jsonl(published_root / "outputs/run-index.jsonl")
    selected = next(
        item
        for item in runs
        if item["run_name"] == "20240502_176-2021-12-B11-FFPE-Kit-KS-128-21-Cx-b1-t1-14-03-2024-LP"
    )

    assert len(runs) == 269
    assert selected["case_number"] == 1
    assert selected["body_donor_number"] == "128-21"
    assert selected["brain_region"] == "prefrontal cortex"
    assert selected["preparation_token"] == "FFPE-Kit"
    assert selected["preservation"] == "formalin-fixed paraffin-embedded"
    assert "Qiagen Qproteome" in str(selected["extraction"])
    assert selected["batch"] == "B11"
    assert selected["biological_replicate"] == 1
    assert selected["technical_replicate"] == 1
    assert selected["file_naming_variants"] == [
        "hyphen_before_batch_instead_of_majority_underscore"
    ]
    assert selected["instrument"] == "Orbitrap Exploris 480"
    assert selected["acquisition"] == "Data-independent acquisition"
    assert selected["quantification"] == "label-free quantification"
    assert selected["sdrf_annotation_provenance"] == (
        "PRIDE community annotation; submitter-unverified"
    )
    assert any(
        field == {"column": "characteristics[disease]", "value": "alzheimer's disease"}
        for field in selected["sdrf_native"]
    )
    assert "patient_diagnosis" not in selected


def test_pairing_does_not_overstate_physical_specimen_identity(published_root: Path) -> None:
    pairings = _jsonl(published_root / "outputs/pairing-index.jsonl")
    selected = next(
        item
        for item in pairings
        if item["body_donor_number"] == "128-21"
        and item["brain_region_token"] == "Cx"
        and item["biological_replicate"] == 1
    )

    assert len(pairings) == 48
    assert selected["physical_specimen_identity_asserted"] is False
    assert set(selected["run_refs_by_preparation"]) == {"FFPE", "FFPE-Kit", "Form", "Fresh"}
    assert all(len(refs) == 2 for refs in selected["run_refs_by_preparation"].values())


def test_source_missingness_retains_partial_submission_gaps(published_root: Path) -> None:
    missingness = _json(published_root / "outputs/source-missingness.json")

    assert missingness["submission_type"] == "PARTIAL"
    assert missingness["repository_support"] == "Unsupported dataset by repository"
    assert missingness["comparison_design_expected_run_count"] == 216
    assert missingness["comparison_design_present_run_count"] == 213
    assert missingness["comparison_design_missing_runs"] == [
        {
            "biological_replicate": 1,
            "body_donor_number": "133-21",
            "brain_region_token": "HC",
            "preparation_token": "FFPE",
            "reason": "Absent from the revision 1 FTP listing; no value was synthesized.",
            "technical_replicate": 2,
        },
        {
            "biological_replicate": 1,
            "body_donor_number": "135-21",
            "brain_region_token": "HC",
            "preparation_token": "FFPE",
            "reason": "Absent from the revision 1 FTP listing; no value was synthesized.",
            "technical_replicate": 2,
        },
        {
            "biological_replicate": 2,
            "body_donor_number": "135-21",
            "brain_region_token": "HC",
            "preparation_token": "FFPE",
            "reason": "Absent from the revision 1 FTP listing; no value was synthesized.",
            "technical_replicate": 2,
        },
    ]
    assert missingness["raw_runs_without_quant_sidecar"] == []
    assert missingness["raw_runs_without_sdrf_row"] == []
    assert missingness["standardized_identification_result_claimed"] is False


def test_context_keeps_protocols_findings_roles_and_boundaries(published_root: Path) -> None:
    context = _json(published_root / "outputs/source-context.json")
    roles = _json(published_root / "outputs/publisher-roles.json")

    assert context["dataset"]["revision"] == 1
    assert context["dataset"]["announce_date"] == "2026-03-17"
    assert context["rights"]["dataset_license_spdx"] == "CC0-1.0"
    assert "DIA-NN 1.8" in str(context["data_processing_protocol"])
    assert "1 % FDR" in str(context["data_processing_protocol"])
    assert context["published_findings_not_recomputed"] == {
        "braak_pilot_potential_biomarkers": 12,
        "fresh_frozen_exclusive_proteins": 35,
        "shared_core_proteins": 1753,
    }
    assert {item["role"] for item in roles["roles"]} == {"dataset submitter", "lab head"}
    assert "Pathologize comparison scores" in context["source_boundaries"]["downstream_only"]
    assert "patient diagnosis" in context["source_boundaries"]["unpublished_fields_not_inferred"]


def test_snapshots_contain_no_proteomics_payloads() -> None:
    snapshot_files = {
        path.name
        for path in (PROJECT_DIR / "snapshots").iterdir()
        if path.name != "snapshot-manifest.json"
    }

    assert snapshot_files == {
        "checksum.txt",
        "community-annotation.sdrf.tsv",
        "donor-name-map.tsv",
        "experiment-overview.txt",
        "ftp-listing.jsonl",
        "pride-project.json",
        "proteomexchange-announcement.xml",
    }
    assert not any(
        path.suffix in {".raw", ".quant", ".fasta", ".speclib"} for path in PROJECT_DIR.rglob("*")
    )


def test_publish_rejects_changed_snapshot(tmp_path: Path) -> None:
    (tmp_path / "contracts").symlink_to(PROJECT_DIR / "contracts", target_is_directory=True)
    snapshots = tmp_path / "snapshots"
    snapshots.mkdir()
    for source in (PROJECT_DIR / "snapshots").iterdir():
        if source.name == "donor-name-map.tsv":
            (snapshots / source.name).write_bytes(source.read_bytes() + b"\n")
        else:
            (snapshots / source.name).symlink_to(source)

    with pytest.raises(ProductError, match="snapshot byte count differs"):
        publish_product(tmp_path)


def test_contract_forbids_payload_commits() -> None:
    payload = _json(PROJECT_DIR / "contracts/source.json")
    payload["artifact_policy"]["commit_proteomics_payloads"] = True

    with pytest.raises(ValidationError):
        SourceContract.model_validate(payload)


def test_metadata_client_rejects_non_official_hosts() -> None:
    with pytest.raises(AcquisitionError, match="not allowlisted"):
        _request("https://example.test/PXD064700")


def test_metadata_client_reads_allowlisted_https(monkeypatch: pytest.MonkeyPatch) -> None:
    class MetadataClient:
        def get_bytes(self, url: str) -> bytes:
            assert url == acquisition.PROJECT_API_URL
            return b'{"accession":"PXD064700"}'

        def get_json_object(self, url: str) -> dict[str, object]:
            assert url == acquisition.PROJECT_API_URL
            return {"accession": "PXD064700"}

    monkeypatch.setattr(acquisition, "_METADATA_CLIENT", MetadataClient())

    assert _request(acquisition.PROJECT_API_URL) == b'{"accession":"PXD064700"}'
    assert acquisition._json_request(acquisition.PROJECT_API_URL) == {"accession": "PXD064700"}


def test_ftp_listing_is_sorted_and_preserves_publisher_locators(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected = [
        RemoteFile(
            file_name="a.raw",
            bytes=10,
            locator=f"ftp://{FTP_HOST}{FTP_DIR}/a.raw",
        )
    ]

    def fake_listing(host: str, directory: str) -> list[RemoteFile]:
        assert host == FTP_HOST
        assert directory == FTP_DIR
        return expected

    monkeypatch.setattr(acquisition, "list_anonymous_ftp_files", fake_listing)

    entries = acquisition._ftp_entries()

    assert entries == expected


def test_refresh_snapshots_writes_normalized_metadata(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    entries = [
        RemoteFile(
            file_name="checksum.txt",
            bytes=12,
            locator=f"ftp://{FTP_HOST}{FTP_DIR}/checksum.txt",
        )
    ]
    payloads = {
        ANNOUNCEMENT_URL: b"<DatasetSummary />",
        acquisition.METADATA_FILES["checksum.txt"]: b"checksum\n",
        acquisition.METADATA_FILES["community-annotation.sdrf.tsv"]: b"sdrf\n",
        acquisition.METADATA_FILES["experiment-overview.txt"]: b"overview\r\n",
        acquisition.METADATA_FILES["donor-name-map.tsv"]: b"donor\r\n",
    }
    monkeypatch.setattr(acquisition, "_json_request", lambda _url: {"accession": "PXD064700"})
    monkeypatch.setattr(acquisition, "_ftp_entries", lambda: entries)
    monkeypatch.setattr(acquisition, "_request", lambda url: payloads[url])

    manifest = refresh_snapshots(tmp_path)

    assert len(manifest.files) == 7
    assert (tmp_path / "snapshots/experiment-overview.txt").read_bytes() == b"overview\n"
    assert (tmp_path / "snapshots/donor-name-map.tsv").read_bytes() == b"donor\n"
    assert _jsonl(tmp_path / "snapshots/ftp-listing.jsonl")[0]["bytes"] == 12


def test_live_verification_uses_pinned_https_identities(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    announcement = (PROJECT_DIR / "snapshots/proteomexchange-announcement.xml").read_bytes()
    ftp_entries = _jsonl(PROJECT_DIR / "snapshots/ftp-listing.jsonl")
    directory = "".join(f'<a href="{item["file_name"]}">x</a>' for item in ftp_entries).encode()
    monkeypatch.setattr(
        "pxd064700_source.acquisition._json_request",
        lambda _url: {"accession": "PXD064700", "submissionType": "PARTIAL"},
    )
    monkeypatch.setattr(
        "pxd064700_source.acquisition._request",
        lambda url: announcement if url == ANNOUNCEMENT_URL else directory,
    )

    identity = verify_live_identity(PROJECT_DIR)

    assert identity["announcement_file_count"] == 551
    assert identity["ftp_file_count"] == 552
    assert DIRECTORY_URL.endswith("/PXD064700/")
