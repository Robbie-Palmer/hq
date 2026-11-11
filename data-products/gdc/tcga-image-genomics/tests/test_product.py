import io
import json
from pathlib import Path
from typing import Any, cast

import pytest

from gdc_tcga_image_genomics import acquisition
from gdc_tcga_image_genomics.acquisition import (
    _allowed_url,
    _fetch_query,
    _query_parameters,
    refresh_product,
)
from gdc_tcga_image_genomics.models import PartitionAssignment, QuerySpec
from gdc_tcga_image_genomics.product import (
    ProductError,
    load_contracts,
    load_native_records,
    publish_product,
    validate_partitions,
    validate_status,
)

PROJECT_DIR = Path(__file__).resolve().parents[1]
FIXTURE_ROOT = PROJECT_DIR / "fixtures/release-46.0"


def test_fixture_publishes_native_records_artifacts_and_missingness(tmp_path: Path) -> None:
    output = tmp_path / "outputs"

    metrics = publish_product(FIXTURE_ROOT, output)

    assert metrics == {
        "annotation_count": 1,
        "artifact_count": 3,
        "case_count": 1,
        "controlled_artifact_count": 0,
        "dataset_id": "gdc-tcga-data-release-46.0",
        "molecular_workflows": {"STAR - Counts": 1, "missing": 1},
        "open_artifact_count": 3,
        "participant_count": 1,
        "patient_leakage_count": 0,
        "record_count": 3,
        "records_by_kind": {"diagnostic_slide": 1, "molecular_evidence": 2},
    }
    records = load_native_records(output / "native-records.jsonl")
    slide = next(record for record in records if record.record_kind == "diagnostic_slide")
    assert slide.source["stain_type"] is None
    assert slide.biospecimen_chains[0].participant_submitter_id == "TCGA-GN-A267"
    assert slide.biospecimen_chains[0].specimen_type == "Solid Tissue"

    artifacts = [
        json.loads(line)
        for line in (output / "artifacts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert artifacts[0]["source_url"].startswith("https://api.gdc.cancer.gov/data/")
    assert {artifact["access"] for artifact in artifacts} == {"open"}

    missingness = json.loads((output / "missingness.json").read_text(encoding="utf-8"))
    stain = next(item for item in missingness["fields"] if item["field"] == "file.stain_type")
    assert stain["missing_count"] == 1
    semantics = json.loads((output / "source-semantics.json").read_text(encoding="utf-8"))
    assert semantics["publisher_roles"] == []
    assert "Pathologize" in semantics["downstream_boundary"]


def test_annotations_are_deduplicated_and_case_links_are_stable(tmp_path: Path) -> None:
    output = tmp_path / "outputs"
    publish_product(FIXTURE_ROOT, output)

    annotations = (output / "annotations.jsonl").read_text(encoding="utf-8").splitlines()
    links = [json.loads(line) for line in (output / "case-links.jsonl").read_text().splitlines()]
    groups = [
        json.loads(line) for line in (output / "leakage-groups.jsonl").read_text().splitlines()
    ]

    assert len(annotations) == 1
    assert links[0]["case_id"] == "ab74d6ed-880e-4470-bfd5-2974a4c3a0d7"
    assert len(links[0]["molecular_evidence_record_ids"]) == 2
    assert groups[0]["leakage_unit"] == "gdc_case"
    assert len(groups[0]["record_ids"]) == 3


def test_patient_level_partition_check_rejects_case_leakage(tmp_path: Path) -> None:
    output = tmp_path / "outputs"
    publish_product(FIXTURE_ROOT, output)
    records = load_native_records(output / "native-records.jsonl")

    with pytest.raises(ProductError, match="patient-level leakage"):
        validate_partitions(
            records,
            [
                PartitionAssignment(record_id=records[0].record_id, partition="train"),
                PartitionAssignment(record_id=records[1].record_id, partition="test"),
            ],
        )


def test_partition_check_rejects_unknown_and_conflicting_records(tmp_path: Path) -> None:
    output = tmp_path / "outputs"
    publish_product(FIXTURE_ROOT, output)
    records = load_native_records(output / "native-records.jsonl")

    with pytest.raises(ProductError, match="unknown record"):
        validate_partitions(records, [PartitionAssignment(record_id="missing", partition="test")])
    with pytest.raises(ProductError, match="multiple partitions"):
        validate_partitions(
            records,
            [
                PartitionAssignment(record_id=records[0].record_id, partition="train"),
                PartitionAssignment(record_id=records[0].record_id, partition="test"),
            ],
        )


def test_partition_check_groups_the_tcga_participant_across_case_ids(tmp_path: Path) -> None:
    output = tmp_path / "outputs"
    publish_product(FIXTURE_ROOT, output)
    records = load_native_records(output / "native-records.jsonl")
    source = records[0]
    alternate = source.model_copy(
        update={
            "record_id": "gdc:file:alternate",
            "biospecimen_chains": [
                source.biospecimen_chains[0].model_copy(update={"case_id": "alternate-case"})
            ],
        }
    )

    with pytest.raises(ProductError, match=r"participants=.*TCGA-GN-A267"):
        validate_partitions(
            [source, alternate],
            [
                PartitionAssignment(record_id=source.record_id, partition="train"),
                PartitionAssignment(record_id=alternate.record_id, partition="test"),
            ],
        )


def test_status_must_match_the_pinned_release() -> None:
    release, _queries = load_contracts()
    status = json.loads((FIXTURE_ROOT / "status.json").read_text(encoding="utf-8"))
    status["data_release_version"]["major"] = 47

    with pytest.raises(ProductError, match=r"expected 46\.0"):
        validate_status(status, release)


def test_controlled_file_is_rejected(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "status.json").write_text(
        (FIXTURE_ROOT / "status.json").read_text(encoding="utf-8"), encoding="utf-8"
    )
    for query in ("diagnostic_slides", "molecular_evidence"):
        (source / query).mkdir()
        page = json.loads((FIXTURE_ROOT / query / "page-00000.json").read_text(encoding="utf-8"))
        if query == "diagnostic_slides":
            page["data"]["hits"][0]["access"] = "controlled"
        (source / query / "page-00000.json").write_text(json.dumps(page), encoding="utf-8")

    with pytest.raises(ProductError, match="controlled file"):
        publish_product(source, tmp_path / "outputs")


def test_gdc_url_allowlist_is_exact() -> None:
    assert _allowed_url("https://api.gdc.cancer.gov/files")
    assert not _allowed_url("http://api.gdc.cancer.gov/files")
    assert not _allowed_url("https://api.gdc.cancer.gov.attacker.example/files")
    assert not _allowed_url("https://api.gdc.cancer.gov:444/files")


def test_query_parameters_are_deterministic() -> None:
    _release, queries = load_contracts()

    parameters = _query_parameters(queries.queries[0], 1000)

    assert parameters["from"] == "1000"
    assert parameters["sort"] == "file_id:asc"
    assert json.loads(parameters["filters"])["op"] == "and"


def test_fetch_query_pages_until_the_pinned_total(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _release, queries = load_contracts()
    query = queries.queries[1].model_copy(update={"expected_full_release_count": 2, "page_size": 1})
    source_page = json.loads(
        (FIXTURE_ROOT / "molecular_evidence/page-00000.json").read_text(encoding="utf-8")
    )

    def fake_get(_url: str, parameters: dict[str, str] | None = None) -> dict[str, object]:
        offset = int((parameters or {})["from"])
        page = json.loads(json.dumps(source_page))
        page["data"]["hits"] = [source_page["data"]["hits"][offset]]
        page["data"]["pagination"].update({"count": 1, "total": 2, "size": 1, "from": offset})
        return page

    monkeypatch.setattr(acquisition, "_get_json", fake_get)
    (tmp_path / "page-99999.json").write_text("stale", encoding="utf-8")

    assert _fetch_query(query, tmp_path) == 2
    assert sorted(path.name for path in tmp_path.iterdir()) == [
        "page-00000.json",
        "page-00001.json",
    ]


def test_fetch_query_rejects_release_count_drift(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _release, queries = load_contracts()
    query = queries.queries[0].model_copy(update={"expected_full_release_count": 2})
    page = json.loads(
        (FIXTURE_ROOT / "diagnostic_slides/page-00000.json").read_text(encoding="utf-8")
    )
    page["data"]["pagination"]["total"] = 1
    monkeypatch.setattr(acquisition, "_get_json", lambda *_args, **_kwargs: page)

    with pytest.raises(ProductError, match="release count"):
        _fetch_query(query, tmp_path)


def test_refresh_checks_status_and_publishes_pages(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "contracts").symlink_to(PROJECT_DIR / "contracts", target_is_directory=True)
    status = json.loads((FIXTURE_ROOT / "status.json").read_text(encoding="utf-8"))
    fixture_pages = {
        query: json.loads((FIXTURE_ROOT / query / "page-00000.json").read_text(encoding="utf-8"))
        for query in ("diagnostic_slides", "molecular_evidence")
    }
    calls: list[str] = []

    def fake_get(url: str, parameters: dict[str, str] | None = None) -> dict[str, object]:
        calls.append(url)
        if url.endswith("/status"):
            return status
        filters = json.loads((parameters or {})["filters"])
        values = filters["content"][-1]["content"]["value"]
        query = "diagnostic_slides" if values == ["Diagnostic Slide"] else "molecular_evidence"
        page = fixture_pages[query]
        page["data"]["pagination"]["total"] = 11901 if query == "diagnostic_slides" else 178567
        page["data"]["pagination"]["count"] = page["data"]["pagination"]["total"]
        return page

    monkeypatch.setattr(acquisition, "_get_json", fake_get)
    monkeypatch.setattr(
        acquisition,
        "_fetch_query",
        lambda query, destination: _write_fixture_page(query, destination, fixture_pages),
    )

    result = refresh_product(tmp_path)

    assert cast(dict[str, object], result["metrics"])["record_count"] == 3
    assert calls == ["https://api.gdc.cancer.gov/status", "https://api.gdc.cancer.gov/status"]


def _write_fixture_page(
    query: QuerySpec, destination: Path, fixture_pages: dict[str, dict[str, Any]]
) -> int:
    destination.mkdir(parents=True)
    payload = fixture_pages[query.query_id]
    (destination / "page-00000.json").write_text(json.dumps(payload), encoding="utf-8")
    return len(cast(dict[str, list[object]], payload["data"])["hits"])


def test_get_json_rejects_non_allowlisted_url() -> None:
    with pytest.raises(ProductError, match="not allowlisted"):
        acquisition._get_json("https://example.test/status")


def test_get_json_reads_a_json_object(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        acquisition,
        "urlopen",
        lambda _request, **_kwargs: io.BytesIO(b'{"ok":true}'),
    )

    assert acquisition._get_json("https://api.gdc.cancer.gov/status") == {"ok": True}
