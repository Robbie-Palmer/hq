import json
from pathlib import Path
from urllib.request import Request

import pytest

from cptac_lscc_source import acquisition
from cptac_lscc_source.models import PdcVersion


class _Response:
    def __init__(self, value: bytes) -> None:
        self.value = value

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self) -> bytes:
        return self.value


def test_request_and_json_helpers_validate_official_responses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[Request] = []

    def fake_urlopen(request: Request, *, timeout: int) -> _Response:
        requests.append(request)
        assert timeout == 120
        return _Response(b'{"data": {"release": 46}}')

    monkeypatch.setattr(acquisition, "urlopen", fake_urlopen)

    assert acquisition._json_request(
        acquisition.GDC_API_URL, payload={"query": "status"}
    ) == {"data": {"release": 46}}
    assert requests[0].method == "POST"
    assert requests[0].data == b'{"query": "status"}'

    monkeypatch.setattr(acquisition, "_request", lambda *_args, **_kwargs: b"[]")
    with pytest.raises(acquisition.AcquisitionError, match="did not return an object"):
        acquisition._json_request(acquisition.GDC_API_URL)


def test_graphql_requires_error_free_data(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        acquisition,
        "_json_request",
        lambda *_args, **_kwargs: {"data": {"study": [{"study_id": "uuid"}]}},
    )
    assert acquisition._graphql("query") == {"study": [{"study_id": "uuid"}]}

    monkeypatch.setattr(
        acquisition,
        "_json_request",
        lambda *_args, **_kwargs: {"errors": [{"message": "bad query"}]},
    )
    with pytest.raises(acquisition.AcquisitionError, match="GraphQL query failed"):
        acquisition._graphql("query")

    monkeypatch.setattr(acquisition, "_json_request", lambda *_args, **_kwargs: {"data": []})
    with pytest.raises(acquisition.AcquisitionError, match="no data object"):
        acquisition._graphql("query")


def test_tcia_snapshots_filter_and_normalize_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rows = [
        {
            "Tumor": "LSCC",
            "Case_ID": f"C3N-{index % 212:05d}",
            "Slide_ID": f"slide-{index:04d}",
        }
        for index in range(1081)
    ]
    rows.append({"Tumor": "LUAD", "Case_ID": "other", "Slide_ID": "ignored"})

    def fake_json_request(url: str, **_kwargs: object) -> dict[str, object]:
        if url == acquisition.TCIA_COLLECTION_URL:
            return {
                "collection_short_title": "CPTAC-LSCC",
                "version_number": 15,
            }
        return {"download_type": "Pathology Images"}

    monkeypatch.setattr(acquisition, "_json_request", fake_json_request)
    monkeypatch.setattr(acquisition.csv, "DictReader", lambda _value: rows)
    monkeypatch.setattr(acquisition, "_request", lambda _url: b"csv")

    collection, download, slides = acquisition._tcia_snapshots()

    assert collection["version_number"] == 15
    assert download["download_type"] == "Pathology Images"
    assert len(slides) == 1081
    assert slides[0]["repository"] == "TCIA"
    assert slides[0]["native_id"] == "slide-0000"


def test_pdc_catalog_and_snapshots_normalize_repository_records(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    catalog = {
        "studyCatalog": [
            {
                "pdc_study_id": "PDC1",
                "versions": [
                    {
                        "study_id": "study-uuid",
                        "study_version": "2",
                        "is_latest_version": "yes",
                    }
                ],
            }
        ]
    }
    monkeypatch.setattr(acquisition, "_graphql", lambda _query: catalog)
    versions, study_uuids = acquisition._pdc_catalog(["PDC1"])
    assert versions == [
        PdcVersion(
            pdc_study_id="PDC1",
            study_id="study-uuid",
            study_version="2",
            is_latest_version="yes",
        )
    ]
    assert study_uuids == {"PDC1": "study-uuid"}

    def fake_graphql(query: str) -> dict[str, object]:
        if "biospecimenPerStudy" in query:
            return {
                "biospecimenPerStudy": [
                    {"aliquot_id": "aliquot-1", "case_id": "case-1"}
                ]
            }
        if "clinicalPerStudy" in query:
            return {"clinicalPerStudy": [{"case_id": "case-1"}]}
        if "filesPerStudy" in query:
            return {"filesPerStudy": [{"file_id": "file-1"}]}
        return {
            "study": [
                {
                    "study_id": "study-uuid",
                    "filesCount": [{"files_count": 1}],
                }
            ]
        }

    monkeypatch.setattr(
        acquisition,
        "_pdc_catalog",
        lambda _study_ids: (versions, study_uuids),
    )
    monkeypatch.setattr(acquisition, "_graphql", fake_graphql)

    result = acquisition._pdc_snapshots(["PDC1"])

    assert result[0] == versions
    assert result[1][0]["native_id"] == "study-uuid"
    assert result[2][0]["native_id"] == "PDC1:aliquot-1"
    assert result[2][0]["native"]["study_id"] == "study-uuid"
    assert result[3][0]["native_id"] == "PDC1:case-1"
    assert result[4][0]["native_id"] == "file-1"


def test_gdc_pagination_and_snapshot_normalization(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payloads: list[dict[str, object]] = []

    def fake_json_request(_url: str, *, payload: dict[str, object]) -> dict[str, object]:
        payloads.append(payload)
        assert isinstance(payload["from"], int)
        offset = payload["from"]
        hits = [{"case_id": "case-1"}, {"case_id": "case-2"}]
        if offset:
            hits = [{"case_id": "case-3"}]
        return {"data": {"hits": hits, "pagination": {"total": 3}}}

    monkeypatch.setattr(acquisition, "_json_request", fake_json_request)
    values = acquisition._gdc_page("cases", {"op": "and"}, "case_id", "samples")
    assert [item["case_id"] for item in values] == ["case-1", "case-2", "case-3"]
    assert payloads[0]["sort"] == "case_id:asc"
    assert payloads[1]["from"] == 2

    monkeypatch.setattr(
        acquisition,
        "_json_request",
        lambda _url: {"data_release": "46", "data_release_version": {"major": 46}},
    )
    monkeypatch.setattr(
        acquisition,
        "_gdc_page",
        lambda endpoint, *_args: (
            [{"file_id": "file-1"}] if endpoint == "files" else [{"case_id": "case-1"}]
        ),
    )
    status, cases, files = acquisition._gdc_snapshots(["C3N-00001"])
    assert status["data_release"] == "46"
    assert cases[0]["native_id"] == "case-1"
    assert files[0]["native_id"] == "file-1"


def test_refresh_snapshots_writes_manifest_and_checksums(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    (tmp_path / "contracts").mkdir()
    (tmp_path / "contracts/sources.json").write_text(
        json.dumps({"product_id": "cptac-test", "pdc_study_ids": ["PDC1"]}),
        encoding="utf-8",
    )
    (tmp_path / "snapshots").mkdir()
    native = {"repository": "PDC", "native_id": "record-1", "native": {"id": "1"}}
    slide = {
        "repository": "TCIA",
        "native_id": "slide-1",
        "native": {"Case_ID": "C3N-00001"},
    }
    version = PdcVersion(
        pdc_study_id="PDC1",
        study_id="study-uuid",
        study_version="2",
        is_latest_version="yes",
    )
    monkeypatch.setattr(
        acquisition,
        "_tcia_snapshots",
        lambda: (
            {"version_number": "15", "modified_gmt": "2026-01-01"},
            {"download_type": "Pathology Images"},
            [slide],
        ),
    )
    monkeypatch.setattr(
        acquisition,
        "_pdc_snapshots",
        lambda _study_ids: ([version], [native], [native], [native], [native]),
    )
    monkeypatch.setattr(
        acquisition,
        "_gdc_snapshots",
        lambda _case_ids: (
            {
                "data_release": "Data Release 46.0",
                "data_release_version": {"major": 46, "minor": 0},
            },
            [native],
            [native],
        ),
    )

    manifest = acquisition.refresh_snapshots(tmp_path)

    assert manifest.product_id == "cptac-test"
    assert manifest.gdc_data_release_version == "46.0"
    assert len(manifest.files) == 9
    assert all(len(item.sha256) == 64 for item in manifest.files)
    stored = json.loads((tmp_path / "snapshots/snapshot-manifest.json").read_text())
    assert stored["tcia_collection_version"] == "15"
