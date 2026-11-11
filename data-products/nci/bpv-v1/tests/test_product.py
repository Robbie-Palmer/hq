import io
import json
import shutil
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from nci_bpv_source import acquisition
from nci_bpv_source.acquisition import (
    _allowed_url,
    _get_bytes,
    _validate_download,
    acquire_public_metadata,
    check_live_metadata,
)
from nci_bpv_source.models import AuthorizedArtifact
from nci_bpv_source.product import (
    PROJECT_DIR,
    ProductError,
    _parse_summary,
    load_contracts,
    publish_product,
    validate_authorized_records,
    verify_fixture_files,
)

FIXTURES = PROJECT_DIR / "fixtures/public-metadata"


def _json_lines(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def test_public_fixture_builds_complete_source_metadata(tmp_path: Path) -> None:
    output = tmp_path / "outputs"

    metrics = publish_product(FIXTURES, output)

    assert metrics == {
        "consented_subject_count": 153,
        "controlled_dataset_family_count": 11,
        "dataset_id": "nci-bpv-phs001304-v1-p1",
        "dictionary_variable_count": 873,
        "public_metadata_bytes": 586171,
        "public_metadata_file_count": 15,
        "substudy_count": 7,
        "summary_missing_value_count": 91329,
        "summary_variable_count": 873,
    }
    study = json.loads((output / "study.json").read_text(encoding="utf-8"))
    assert study["study_accession"] == "phs001304.v1.p1"
    assert study["bioproject_accession"] == "PRJNA932917"
    assert len(study["diagnoses"]) == 4
    assert study["publisher_partition_roles"] == []
    assert study["sop_library_revision"] == "2019-02-13"
    assert len(study["sop_documents"]) == 35
    assert len(study["publications"]) == 5

    substudies = {item["accession"]: item for item in _json_lines(output / "substudies.jsonl")}
    assert substudies["phs001639.v1.p1"]["reported_counts"] == {
        "donors": 37,
        "samples": 395,
    }
    assert "matched FFPE tumor tissue" in substudies["phs001639.v1.p1"]["materials"]
    assert "OCT embedded tissue" in substudies["phs001638.v1.p1"]["materials"]
    assert "12-14 months storage" in substudies["phs001640.v1.p1"]["preanalytic_variables"]


def test_outputs_preserve_native_variables_summaries_and_access_limits(tmp_path: Path) -> None:
    output = tmp_path / "outputs"
    publish_product(FIXTURES, output)

    variables = _json_lines(output / "variables.jsonl")
    names = {(item["substudy_accession"], item["name"]) for item in variables}
    assert ("phs001639.v1.p1", "DELAY_TO_FIXATION_TIME") in names
    assert ("phs001637.v1.p1", "aliquot_id") in names
    assert ("phs001640.v1.p1", "Aliquot ID") in names
    assert ("phs001638.v1.p1", "Freezer") in names

    missingness = _json_lines(output / "missingness.jsonl")
    ngs_rin = next(
        item
        for item in missingness
        if item["substudy_accession"] == "phs001639.v1.p1" and item["name"] == "RIN"
    )
    assert ngs_rin["observed_count"] == 257
    assert ngs_rin["missing_count"] == 83

    summaries = _json_lines(output / "summary-statistics.jsonl")
    protocol = next(
        item
        for item in summaries
        if item["substudy_accession"] == "phs001639.v1.p1" and item["name"] == "Protocol Definition"
    )
    assert {item["value"] for item in protocol["public_summary_values"]} >= {
        "Delay to Fixation; 1hr",
        "Time in Fixative; 72hr",
    }

    inventory = json.loads((output / "source-inventory.json").read_text(encoding="utf-8"))
    controlled = inventory["controlled_dataset_families"]
    assert all(item["access_tier"] == "dbGaP authorized" for item in controlled)
    assert all(item["checksum"] is None for item in controlled)
    rights = json.loads((output / "access-and-rights.json").read_text(encoding="utf-8"))
    assert "No general redistribution license" in rights["redistribution"]
    identity = json.loads((output / "identity-contract.json").read_text(encoding="utf-8"))
    assert identity["native_granularities"] == [
        "subject",
        "specimen",
        "block",
        "aliquot",
        "assay",
        "artifact",
    ]


def test_fixture_inventory_rejects_extra_and_changed_files(tmp_path: Path) -> None:
    _study, inventory, _rights, _identity = load_contracts()
    fixture_copy = tmp_path / "fixtures"
    shutil.copytree(FIXTURES, fixture_copy)
    (fixture_copy / "extra.xml").write_text("extra", encoding="utf-8")

    with pytest.raises(ProductError, match="differ from the source inventory"):
        verify_fixture_files(inventory, fixture_copy)

    (fixture_copy / "extra.xml").unlink()
    target = fixture_copy / inventory.public_metadata_files[0].file_name
    target.write_bytes(target.read_bytes() + b"changed")
    with pytest.raises(ProductError, match="byte count"):
        verify_fixture_files(inventory, fixture_copy)


def test_contract_dataset_ids_must_match(tmp_path: Path) -> None:
    shutil.copytree(PROJECT_DIR / "contracts", tmp_path / "contracts")
    identity_path = tmp_path / "contracts/identity-contract.json"
    identity = json.loads(identity_path.read_text(encoding="utf-8"))
    identity["dataset_id"] = "different"
    identity_path.write_text(json.dumps(identity), encoding="utf-8")

    with pytest.raises(ProductError, match="contract dataset identifiers differ"):
        load_contracts(tmp_path)


def test_summary_parser_rejects_a_variable_without_statistics(tmp_path: Path) -> None:
    path = tmp_path / "report.xml"
    path.write_text(
        '<data_table dataset_id="pht000001.v1" study_id="phs001634.v1">'
        '<variable id="phv000001.v1.p1" var_name="x"><total /></variable>'
        "</data_table>",
        encoding="utf-8",
    )

    with pytest.raises(ProductError, match="has no total statistic"):
        _parse_summary(path)


def _authorized_record(record_id: str, specimen: str, aliquot: str) -> dict[str, Any]:
    return {
        "record_id": record_id,
        "study_accession": "phs001304.v1.p1",
        "substudy_accession": "phs001639.v1.p1",
        "participant_id": "TEST-PARTICIPANT",
        "specimen_id": specimen,
        "block_id": f"{specimen}-BLOCK",
        "aliquot_id": aliquot,
        "parent_specimen_id": specimen,
        "matched_specimen_id": None,
        "matched_aliquot_id": None,
        "material": "publisher fixture material",
        "cold_ischemia_minutes": 60,
        "fixation_duration_minutes": 720,
        "freezing_method": None,
        "storage_temperature": None,
        "storage_duration": None,
        "embedding": "publisher fixture embedding",
        "collection_site": "TEST-SITE",
        "pathology_review": {"native_result": "publisher fixture result"},
        "publisher_role": "publisher fixture role",
        "assays": [
            {
                "assay_id": f"{aliquot}-ASSAY",
                "assay_type": "RNA-seq",
                "platform": "publisher fixture platform",
                "quality_fields": {"RIN": None},
                "outcomes": {},
                "artifacts": [
                    {
                        "artifact_id": f"{aliquot}-FILE",
                        "native_file_name": "fixture.dat",
                        "repository_url": "https://example.test/fixture.dat",
                        "access_tier": "dbGaP authorized",
                        "bytes": None,
                        "checksum_algorithm": None,
                        "checksum": None,
                        "missing_reason": "not visible in fixture",
                    }
                ],
            }
        ],
        "missing_fields": [{"field": "RIN", "reason": "publisher source is null"}],
        "source_references": [{"title": "test-only fixture", "url": "https://example.test/source"}],
    }


def test_authorized_records_validate_in_place_without_emitting_identities(tmp_path: Path) -> None:
    first = _authorized_record("record-1", "specimen-1", "aliquot-1")
    second = _authorized_record("record-2", "specimen-2", "aliquot-2")
    first["matched_specimen_id"] = "specimen-2"
    first["matched_aliquot_id"] = "aliquot-2"
    records = tmp_path / "authorized.jsonl"
    records.write_text(
        json.dumps(first) + "\n" + json.dumps(second) + "\n",
        encoding="utf-8",
    )

    assert validate_authorized_records(records) == {
        "artifact_count": 2,
        "assay_count": 2,
        "participant_count": 1,
        "record_count": 2,
        "substudy_count": 1,
    }


def test_authorized_record_links_and_ids_must_be_valid(tmp_path: Path) -> None:
    path = tmp_path / "authorized.jsonl"
    path.write_text("", encoding="utf-8")
    with pytest.raises(ProductError, match="is empty"):
        validate_authorized_records(path)

    record = _authorized_record("record-1", "specimen-1", "aliquot-1")
    path.write_text(json.dumps(record) + "\n" + json.dumps(record) + "\n", encoding="utf-8")
    with pytest.raises(ProductError, match="record IDs must be unique"):
        validate_authorized_records(path)

    record["matched_specimen_id"] = "missing"
    path.write_text(json.dumps(record) + "\n", encoding="utf-8")
    with pytest.raises(ProductError, match="matched specimen link"):
        validate_authorized_records(path)

    record["matched_specimen_id"] = None
    record["matched_aliquot_id"] = "missing"
    path.write_text(json.dumps(record) + "\n", encoding="utf-8")
    with pytest.raises(ProductError, match="matched aliquot link"):
        validate_authorized_records(path)


def test_artifact_checksum_contract_is_fail_closed() -> None:
    with pytest.raises(ValidationError, match="either a complete checksum"):
        AuthorizedArtifact.model_validate(
            {
                "artifact_id": "file-1",
                "native_file_name": "file.dat",
                "repository_url": "https://example.test/file.dat",
                "access_tier": "dbGaP authorized",
                "checksum_algorithm": None,
                "checksum": None,
                "missing_reason": None,
            }
        )
    with pytest.raises(ValidationError, match="32 hexadecimal"):
        AuthorizedArtifact.model_validate(
            {
                "artifact_id": "file-1",
                "native_file_name": "file.dat",
                "repository_url": "https://example.test/file.dat",
                "access_tier": "dbGaP authorized",
                "checksum_algorithm": "md5",
                "checksum": "abc",
                "missing_reason": None,
            }
        )


def test_live_url_allowlist_is_exact() -> None:
    assert _allowed_url(
        "https://ftp.ncbi.nlm.nih.gov/dbgap/studies/phs001304/phs001304.v1.p1/fixture.xml"
    )
    assert _allowed_url(
        "https://www.ncbi.nlm.nih.gov/projects/gap/cgi-bin/study.cgi?study_id=phs001304.v1.p1"
    )
    assert _allowed_url("https://www.ncbi.nlm.nih.gov/bioproject/932917")
    assert not _allowed_url("http://ftp.ncbi.nlm.nih.gov/dbgap/studies/phs001304/file.xml")
    assert not _allowed_url("https://ftp.ncbi.nlm.nih.gov/dbgap/studies/phs999999/file.xml")
    assert not _allowed_url("https://ftp.ncbi.nlm.nih.gov.attacker.test/dbgap/studies/file.xml")
    assert not _allowed_url("https://www.ncbi.nlm.nih.gov:444/bioproject/932917")
    assert not _allowed_url(
        "https://www.ncbi.nlm.nih.gov/projects/gap/cgi-bin/study.cgi?study_id=phs999999.v1.p1"
    )


class _Response(io.BytesIO):
    def __init__(self, content: bytes, url: str) -> None:
        super().__init__(content)
        self._url = url

    def geturl(self) -> str:
        return self._url


def test_get_bytes_checks_url_and_redirect(monkeypatch: pytest.MonkeyPatch) -> None:
    allowed = "https://www.ncbi.nlm.nih.gov/bioproject/932917"
    monkeypatch.setattr(acquisition, "urlopen", lambda *_args, **_kwargs: _Response(b"ok", allowed))
    assert _get_bytes(allowed) == b"ok"
    with pytest.raises(ProductError, match="not allowlisted"):
        _get_bytes("https://example.test/file")

    monkeypatch.setattr(
        acquisition,
        "urlopen",
        lambda *_args, **_kwargs: _Response(b"bad", "https://example.test/redirect"),
    )
    with pytest.raises(ProductError, match="redirect is not allowlisted"):
        _get_bytes(allowed)


def test_live_check_uses_only_pinned_public_content(monkeypatch: pytest.MonkeyPatch) -> None:
    _study, inventory, _rights, _identity = load_contracts()
    by_url = {
        str(item.url): (FIXTURES / item.file_name).read_bytes()
        for item in inventory.public_metadata_files
    }
    for url, tokens in acquisition.LIVE_PAGES.items():
        by_url[url] = " ".join(tokens).encode()
    monkeypatch.setattr(acquisition, "_get_bytes", lambda url: by_url[url])

    assert check_live_metadata() == {"bytes": 586171, "pages": 2, "pinned_files": 15}

    by_url[next(iter(acquisition.LIVE_PAGES))] = b"missing"
    with pytest.raises(ProductError, match="missing pinned BPV identifiers"):
        check_live_metadata()


def test_acquire_validates_before_writing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    shutil.copytree(PROJECT_DIR / "contracts", tmp_path / "contracts")
    _study, inventory, _rights, _identity = load_contracts(tmp_path)
    by_url = {
        str(item.url): (FIXTURES / item.file_name).read_bytes()
        for item in inventory.public_metadata_files
    }
    monkeypatch.setattr(acquisition, "_get_bytes", lambda url: by_url[url])

    assert acquire_public_metadata(tmp_path) == {"bytes": 586171, "files": 15}
    assert len(list((tmp_path / "fixtures/public-metadata").iterdir())) == 15

    first = inventory.public_metadata_files[0]
    with pytest.raises(ProductError, match="live byte count"):
        _validate_download(first, b"wrong")
