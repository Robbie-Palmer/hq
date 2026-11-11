import hashlib
import io
import json
from http.client import HTTPMessage
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from urllib.request import Request

import pytest

from gtex_histology_source_data import product, source
from gtex_histology_source_data.models import (
    AcquisitionEvidence,
    AcquisitionFile,
    Artifact,
    Snapshot,
    SourceManifest,
)
from gtex_histology_source_data.product import (
    _histology_records,
    _molecular_records,
    _reconciliation,
    build_product,
)
from gtex_histology_source_data.source import (
    SourceDataError,
    _anvil_svs,
    _download,
    _gtex_histology,
    _HttpsOnlyRedirectHandler,
    _idc_instances,
    _idc_rows,
    _idc_series,
    _require_https,
    _validate_existing,
    _verify_download,
    _write_snapshot,
    load_manifest,
    verify_live_identities,
)

PROJECT_DIR = Path(__file__).resolve().parents[1]


def test_publisher_requests_require_https() -> None:
    _require_https("https://example.org/metadata.json")

    with pytest.raises(SourceDataError, match="must use HTTPS"):
        _require_https("http://example.org/metadata.json")


def _histology_row(image_id: str, sample_id: str | None = None) -> dict[str, object]:
    return {
        "ageBracket": "60-69",
        "hardyScale": "Slow death",
        "hide": False,
        "histologyImageId": image_id,
        "pathologyNotes": "clean specimen",
        "pathologyNotesCategories": {"clean_specimens": True, "fibrosis": False},
        "sampleId": sample_id,
        "sex": "female",
        "subjectId": "GTEX-AAAA",
        "tissueSampleId": image_id if sample_id is not None else None,
        "tissueSiteDetail": "Artery - Tibial",
    }


def _jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows), encoding="utf-8"
    )


def _write_static_fixture(root: Path) -> None:
    static = root / "data/raw/static"
    static.mkdir(parents=True)
    sample_header = "\t".join(
        [
            "SAMPID",
            "SMATSSCR",
            "SMCENTER",
            "SMPTHNTS",
            "SMRIN",
            "SMTS",
            "SMTSD",
            "SMUBRID",
            "SMTSISCH",
            "SMTSPAX",
            "SMNABTCH",
            "SMNABTCHT",
            "SMNABTCHD",
            "SMGEBTCH",
            "SMGEBTCHD",
            "SMGEBTCHT",
            "SMAFRZE",
        ]
    )
    rows = [
        "\t".join(
            [
                "GTEX-AAAA-0126-SM-ABCDE",
                "2",
                "B1",
                "note",
                "7.2",
                "Blood Vessel",
                "Artery - Tibial",
                "0007610",
                "90",
                "480",
                "batch-1",
                "RNA isolation",
                "01/01/2020",
                "expression-1",
                "01/02/2020",
                "RNASEQ",
                "RNASEQ",
            ]
        ),
        "\t".join(["GTEX-AAAA-0226-SM-FGHIJ", *([""] * 16)]),
    ]
    (static / "GTEx_Analysis_v8_Annotations_SampleAttributesDS.txt").write_text(
        sample_header + "\n" + "\n".join(rows) + "\n", encoding="utf-8"
    )
    (static / "GTEx_Analysis_v8_Annotations_SubjectPhenotypesDS.txt").write_text(
        "SUBJID\tSEX\tAGE\tDTHHRDY\nGTEX-AAAA\t2\t60-69\t4\n", encoding="utf-8"
    )


def test_committed_manifest_pins_distinct_publisher_counts() -> None:
    manifest = load_manifest(PROJECT_DIR)

    assert isinstance(manifest, SourceManifest)
    counts = {identity.name: identity.counts for identity in manifest.identities}
    assert counts["Imaging Data Commons"]["series"] == 25503
    assert counts["GTEx Portal"]["histology_api_records"] == 25713
    assert counts["AnVIL Data Explorer"]["svs_files"] == 25708
    assert manifest.preparation.published_fixation_hours_min == 6
    assert manifest.preparation.published_fixation_hours_max == 24
    assert "not the same section" in manifest.preparation.procurement_relationship


def test_manifest_rejects_collapsed_source_counts() -> None:
    payload = json.loads((PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"))
    idc = next(item for item in payload["identities"] if item["name"] == "Imaging Data Commons")
    idc["counts"]["series"] = 25713

    with pytest.raises(ValueError, match="IDC series count"):
        SourceManifest.model_validate(payload)

    payload = json.loads((PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"))
    payload["identities"] = [
        identity for identity in payload["identities"] if identity["name"] != "Zenodo"
    ]
    with pytest.raises(ValueError, match="all five publisher identities"):
        SourceManifest.model_validate(payload)


def test_molecular_records_preserve_preanalytic_values_and_missingness(tmp_path: Path) -> None:
    _write_static_fixture(tmp_path)
    static = tmp_path / "data/raw/static"

    records = _molecular_records(
        static / "GTEx_Analysis_v8_Annotations_SampleAttributesDS.txt",
        static / "GTEx_Analysis_v8_Annotations_SubjectPhenotypesDS.txt",
    )

    assert records[0].tissue_sample_id == "GTEX-AAAA-0126"
    assert records[0].aliquot_id == "SM-ABCDE"
    assert records[0].autolysis_score == 2
    assert records[0].rin == 7.2
    assert records[0].total_ischemic_time_minutes == 90
    assert records[0].paxgene_fixative_time_minutes == 480
    assert records[0].collection_site == "B1"
    assert records[0].genotype_expression_batch_id == "expression-1"
    assert records[0].missing_fields == []
    assert "rin" in records[1].missing_fields
    assert records[1].sex_code == 2


def test_histology_records_keep_publisher_notes_categories_and_null_links() -> None:
    records = _histology_records(
        [
            _histology_row("GTEX-AAAA-0126", "GTEX-AAAA-0126-SM-ABCDE"),
            _histology_row("GTEX-AAAA-0226"),
        ]
    )

    assert records[0].pathology_categories == ["clean_specimens"]
    assert records[0].molecular_sample_id == "GTEX-AAAA-0126-SM-ABCDE"
    assert records[1].tissue_sample_id is None
    assert records[1].molecular_sample_id is None


def test_reconciliation_uses_exact_identifiers_only(tmp_path: Path) -> None:
    _write_static_fixture(tmp_path)
    static = tmp_path / "data/raw/static"
    molecular = _molecular_records(
        static / "GTEx_Analysis_v8_Annotations_SampleAttributesDS.txt",
        static / "GTEx_Analysis_v8_Annotations_SubjectPhenotypesDS.txt",
    )
    histology = _histology_records(
        [
            _histology_row("GTEX-AAAA-0126", "GTEX-AAAA-0126-SM-ABCDE"),
            _histology_row("GTEX-AAAA-0226"),
        ]
    )
    anvil = [{"file_name": "GTEX-AAAA-0126.svs"}]
    series = [
        {
            "PatientID": "GTEX-AAAA",
            "ContainerIdentifier": "GTEX-AAAA-0125",
        }
    ]

    result = _reconciliation(histology, molecular, anvil, series)

    assert result["gtex_api_to_anvil_svs"]["exact_image_id_matches"] == 1
    assert result["gtex_api_to_idc_subjects"]["exact_subject_matches"] == 1
    assert result["gtex_api_to_idc_images"]["exact_histology_id_to_container_matches"] == 0
    assert result["gtex_api_to_idc_images"]["crosswalk_status"] == "unavailable"


def test_build_product_writes_all_native_namespaces(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    raw = tmp_path / "data/raw"
    raw.mkdir(parents=True)
    (raw / "acquisition.json").write_text("{}\n", encoding="utf-8")
    _jsonl(
        raw / "gtex-histology-api.jsonl",
        [
            _histology_row("GTEX-AAAA-0126", "GTEX-AAAA-0126-SM-ABCDE"),
            _histology_row("GTEX-AAAA-0226"),
        ],
    )
    _jsonl(
        raw / "anvil-svs.jsonl",
        [
            {
                "file_name": "GTEX-AAAA-0126.svs",
                "file_size": 100,
                "file_md5sum": "a" * 32,
                "drs_uri": "drs://example",
                "azul_url": "https://example.test/file",
            }
        ],
    )
    series: dict[str, Any] = {
        "PatientID": "GTEX-AAAA",
        "StudyInstanceUID": "1.2.3",
        "SeriesInstanceUID": "1.2.3.4",
        "ContainerIdentifier": "GTEX-AAAA-0125",
        "license_short_name": "CC BY 4.0",
        "source_DOI": "10.5281/zenodo.11099099",
        "tissueFixative_CodeMeaning": ["PAXgene Tissue System"],
        "embeddingMedium_CodeMeaning": ["Paraffin wax"],
        "staining_usingSubstance_CodeMeaning": ["hematoxylin stain", "water soluble eosin stain"],
        "primaryAnatomicStructure_CodeMeaning": "Tibial artery",
    }
    _jsonl(raw / "idc-series.jsonl", [series])
    _jsonl(raw / "idc-instances.jsonl", [{"instance_size": 80}])
    _write_static_fixture(tmp_path)
    identities = [SimpleNamespace(name="GTEx Portal", counts={"v8_sample_attribute_rows": 2})]
    snapshots = [
        SimpleNamespace(name="gtex_histology_api", expected_records=2),
        SimpleNamespace(name="anvil_svs", expected_records=1),
        SimpleNamespace(name="idc_series", expected_records=1),
        SimpleNamespace(name="idc_instances", expected_records=1),
    ]
    monkeypatch.setattr(
        product,
        "load_manifest",
        lambda _root: SimpleNamespace(
            dataset_id="fixture", identities=identities, snapshots=snapshots
        ),
    )

    metrics = build_product(tmp_path)

    assert metrics["record_counts"]["gtex-histology-images.jsonl"] == 2
    assert metrics["idc_instance_bytes"] == 80
    reconciliation = json.loads(
        (tmp_path / "outputs/reconciliation.json").read_text(encoding="utf-8")
    )
    assert reconciliation["gtex_api_to_anvil_svs"]["gtex_api_only_ids"] == ["GTEX-AAAA-0226"]


def test_snapshot_writer_checks_count_and_digest(tmp_path: Path) -> None:
    record = {"id": "a"}
    expected = hashlib.sha256(b'{"id":"a"}\n').hexdigest()
    snapshot = Snapshot(
        name="gtex_histology_api",
        endpoint="https://example.test/api",
        expected_records=1,
        canonical_sha256=expected,
    )

    evidence = _write_snapshot(tmp_path / "snapshot.jsonl", [record], snapshot)

    assert evidence.records == 1
    assert evidence.sha256 == expected
    changed = snapshot.model_copy(update={"canonical_sha256": "f" * 64})
    with pytest.raises(SourceDataError, match="canonical SHA-256 changed"):
        _write_snapshot(tmp_path / "changed.jsonl", [record], changed)

    wrong_count = snapshot.model_copy(update={"expected_records": 2})
    with pytest.raises(SourceDataError, match="returned 1 records"):
        _write_snapshot(tmp_path / "wrong-count.jsonl", [record], wrong_count)


def test_gtex_histology_fetch_checks_total_and_sorts(monkeypatch: pytest.MonkeyPatch) -> None:
    snapshot = Snapshot(
        name="gtex_histology_api",
        endpoint="https://example.test/api",
        expected_records=2,
        canonical_sha256="0" * 64,
    )
    monkeypatch.setattr(
        source,
        "_request_json",
        lambda _url: {
            "paging_info": {"totalNumberOfItems": 2},
            "data": [{"histologyImageId": "b"}, {"histologyImageId": "a"}],
        },
    )

    assert [row["histologyImageId"] for row in _gtex_histology(snapshot)] == ["a", "b"]

    monkeypatch.setattr(
        source,
        "_request_json",
        lambda _url: {"paging_info": {"totalNumberOfItems": 3}, "data": []},
    )
    with pytest.raises(SourceDataError, match="total changed"):
        _gtex_histology(snapshot)


def test_anvil_fetch_preserves_integrity_and_retrieval_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    snapshot = Snapshot(
        name="anvil_svs",
        endpoint="https://example.test/files",
        expected_records=1,
        canonical_sha256="0" * 64,
    )
    payload = {
        "pagination": {"total": 1, "next": None},
        "hits": [
            {
                "sources": [{"source_id": "source", "source_spec": "snapshot"}],
                "datasets": [
                    {
                        "consent_group": ["NRES"],
                        "dataset_id": ["dataset"],
                        "title": ["ANVIL_GTEx_public_data"],
                    }
                ],
                "files": [
                    {
                        "accessible": True,
                        "azul_mirror_uri": "s3://mirror/hash.md5",
                        "azul_url": "https://example.test/file",
                        "document_id": "document",
                        "drs_uri": "drs://file",
                        "file_format": ".svs",
                        "file_id": "id",
                        "file_md5sum": "a" * 32,
                        "file_name": "GTEX-AAAA-0126.svs",
                        "file_path": "gtex_histology_svs_files/GTEX-AAAA-0126.svs",
                        "file_size": 100,
                        "is_supplementary": True,
                    }
                ],
            }
        ],
    }
    monkeypatch.setattr(source, "_request_json", lambda _url: payload)

    record = _anvil_svs(snapshot)[0]

    assert record["file_md5sum"] == "a" * 32
    assert record["drs_uri"] == "drs://file"
    assert record["consent_group"] == "NRES"

    payload["pagination"] = {"total": 2, "next": None}
    with pytest.raises(SourceDataError, match="SVS total changed"):
        _anvil_svs(snapshot)


def test_idc_fetch_uses_read_only_paged_query(monkeypatch: pytest.MonkeyPatch) -> None:
    snapshot = Snapshot(
        name="idc_series",
        endpoint="https://example.test/sql",
        expected_records=2,
        canonical_sha256="0" * 64,
    )

    def fake_request(_url: str, payload: dict[str, object]) -> dict[str, object]:
        assert str(payload["sql"]).startswith("SELECT value FROM index i")
        assert payload["params"] == ["gtex"]
        return {"rows": [{"value": "a"}, {"value": "b"}], "truncated": False}

    monkeypatch.setattr(source, "_request_json", fake_request)

    assert _idc_rows(snapshot, "value", "index i", "value") == [
        {"value": "a"},
        {"value": "b"},
    ]

    monkeypatch.setattr(
        source,
        "_request_json",
        lambda _url, _payload: {"rows": [], "truncated": True},
    )
    with pytest.raises(SourceDataError, match="truncated or invalid"):
        _idc_rows(snapshot, "value", "index i", "value")


def test_idc_snapshot_queries_select_publisher_identifiers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, str, str]] = []

    def fake_rows(
        _snapshot: Snapshot, columns: str, joins: str, order: str
    ) -> list[dict[str, object]]:
        calls.append((columns, joins, order))
        return [{"ok": True}]

    monkeypatch.setattr(source, "_idc_rows", fake_rows)
    series = Snapshot(
        name="idc_series",
        endpoint="https://example.test/sql",
        expected_records=1,
        canonical_sha256="0" * 64,
    )
    instances = series.model_copy(update={"name": "idc_instances"})

    assert _idc_series(series) == [{"ok": True}]
    assert _idc_instances(instances) == [{"ok": True}]
    assert "ContainerIdentifier" in calls[0][0]
    assert "SOPInstanceUID" in calls[1][0]


def test_download_verifies_bytes_and_hashes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    content = b"metadata"
    artifact = Artifact(
        name="metadata.txt",
        url="https://example.test/metadata.txt",
        bytes=len(content),
        md5=hashlib.md5(content).hexdigest(),  # noqa: S324 - publisher MD5 evidence.
        sha256=hashlib.sha256(content).hexdigest(),
        media_type="text/plain",
    )

    class FakeOpener:
        def open(self, request: Request, timeout: int) -> io.BytesIO:
            assert request.full_url == str(artifact.url)
            assert timeout == 90
            return io.BytesIO(content)

    monkeypatch.setattr(source, "_opener", FakeOpener)
    destination = tmp_path / "metadata.txt"

    _download(artifact, destination)

    assert destination.read_bytes() == content
    assert not destination.with_suffix(".txt.part").exists()

    destination.write_bytes(b"wrong")
    with pytest.raises(SourceDataError, match="byte count differs"):
        _verify_download(destination, artifact)


def test_existing_acquisition_rejects_changed_file(tmp_path: Path) -> None:
    path = tmp_path / "metadata.jsonl"
    path.write_text("original\n", encoding="utf-8")
    evidence = AcquisitionEvidence(
        dataset_id="fixture",
        files=[
            AcquisitionFile(
                name=path.name,
                bytes=path.stat().st_size,
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
            )
        ],
    )
    _validate_existing(tmp_path, evidence)
    path.write_text("changed\n", encoding="utf-8")

    with pytest.raises(SourceDataError, match="incomplete or changed"):
        _validate_existing(tmp_path, evidence)


def test_live_identity_check_reads_counts_without_downloading_images(  # noqa: C901
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_json(url: str, _payload: object = None) -> dict[str, object]:
        if "histology/image" in url:
            return {"paging_info": {"totalNumberOfItems": 25713}}
        if url.endswith("/version"):
            return {"idc_version": "v25", "idc_index_data_version": "25.0.5"}
        if url.endswith("/collections/gtex"):
            return {"series": 25503, "instances": 128708}
        if "explore.anvilproject.org" in url:
            return {
                "pagination": {"total": 25708},
                "hits": [{"sources": [{"source_spec": "snapshot"}]}],
            }
        if "zenodo.org" in url:
            return {"id": 11099100, "conceptdoi": "10.5281/zenodo.11099099"}
        raise AssertionError(url)

    class FakeResponse:
        status = 200

        def __enter__(self) -> "FakeResponse":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def geturl(self) -> str:
            return "https://brd.cancer.gov/"

    class FakeOpener:
        def open(self, _request: Request, timeout: int) -> FakeResponse:
            assert timeout == 30
            return FakeResponse()

    monkeypatch.setattr(source, "_request_json", fake_json)
    monkeypatch.setattr(source, "_opener", FakeOpener)

    result = verify_live_identities(PROJECT_DIR)

    assert result["idc_series"] == 25503
    assert result["brd_legacy"] == {
        "final_url": "https://brd.cancer.gov/",
        "status": 200,
    }


def test_redirect_handler_rejects_non_https_destination() -> None:
    handler = _HttpsOnlyRedirectHandler()

    with pytest.raises(SourceDataError, match="redirect must use HTTPS"):
        handler.redirect_request(
            Request("https://example.test/source"),
            io.BytesIO(),
            302,
            "Found",
            HTTPMessage(),
            "http://example.test/destination",
        )
