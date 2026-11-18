import hashlib
import io
import json
from pathlib import Path
from typing import Any
from zipfile import ZipFile

import pytest

from segpath_source_data import source
from segpath_source_data.models import SourceManifest
from segpath_source_data.source import (
    SourceDataError,
    _download,
    _source_allowed,
    acquire_artifacts,
    acquire_metadata,
    index_metadata,
    load_manifest,
    load_table_s2,
    verify_metadata_contract,
)

PROJECT_DIR = Path(__file__).resolve().parents[1]


def _fixture_manifest(root: Path) -> dict[str, Any]:
    payload = json.loads((PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"))
    payload["expected"]["record_count"] = 8
    payload["expected"]["artifact_count"] = 16
    for task in payload["tasks"]:
        task["expected"] = {
            "records": 1,
            "slides": 1,
            "source_roles": {"train": 1, "val": 0, "test": 0},
        }
    (root / "manifest.json").write_text(json.dumps(payload), encoding="utf-8")
    return payload


def _write_table_s2(path: Path, tasks: list[dict[str, object]]) -> None:
    values = [
        "Table S2. Histopathological specimen in SegPath",
        "TMA number",
        "tumour type",
        "Antibody target",
    ]
    rows: list[tuple[str, str, str]] = []
    for index, task in enumerate(tasks, start=1):
        tumour_type = f"Publisher tumour {index}"
        target = str(task["table_s2_antibody_target"])
        if task["task_id"] == "ERG_Endothelium":
            target = "CD3/CD20"
        values.extend((tumour_type, target))
        rows.append((str(index), tumour_type, target))
    shared = "".join(f"<si><t>{value}</t></si>" for value in values)
    indexes = {value: index for index, value in enumerate(values)}
    xml_rows = [
        '<row r="1"><c r="A1" t="s"><v>0</v></c></row>',
        (
            '<row r="2"><c r="A2" t="s"><v>1</v></c>'
            '<c r="B2" t="s"><v>2</v></c><c r="C2" t="s"><v>3</v></c></row>'
        ),
    ]
    for row_number, (slide, tumour_type, target) in enumerate(rows, start=3):
        xml_rows.append(
            f'<row r="{row_number}"><c r="A{row_number}"><v>{slide}</v></c>'
            f'<c r="B{row_number}" t="s"><v>{indexes[tumour_type]}</v></c>'
            f'<c r="C{row_number}" t="s"><v>{indexes[target]}</v></c></row>'
        )
    with ZipFile(path, "w") as archive:
        archive.writestr(
            "xl/sharedStrings.xml",
            (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                f"{shared}</sst>"
            ),
        )
        archive.writestr(
            "xl/worksheets/sheet1.xml",
            (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                f"<sheetData>{''.join(xml_rows)}</sheetData></worksheet>"
            ),
        )


def _write_metadata(root: Path, payload: dict[str, Any]) -> None:
    metadata = root / "data/metadata"
    metadata.mkdir(parents=True)
    tasks = payload["tasks"]
    assert isinstance(tasks, list)
    _write_table_s2(metadata / "table-s2.xlsx", tasks)
    for index, task in enumerate(tasks, start=1):
        assert isinstance(task, dict)
        task_id = str(task["task_id"])
        antibody = str(task["antibody"])
        metadata_file = task["metadata"]
        assert isinstance(metadata_file, dict)
        stem = f"{task_id}_{index:03d}_{index * 100:06d}_{index * 200:06d}"
        rows = [
            "antibody,filename,train_val_test",
            f"{antibody},{task_id}/{stem}_mask.png,train",
            f"{antibody},{task_id}/{stem}_HE.png,train",
        ]
        (metadata / str(metadata_file["filename"])).write_text(
            "\n".join(rows) + "\n", encoding="utf-8"
        )


def test_committed_manifest_preserves_native_tasks_rights_and_provenance() -> None:
    manifest = load_manifest(PROJECT_DIR)

    assert manifest.license.spdx_id == "CC-BY-NC-SA-4.0"
    assert manifest.expected.record_count == 158687
    assert manifest.expected.archive_bytes == 305_525_589_629
    assert {task.task_id for task in manifest.tasks} == {
        "panCK_Epithelium",
        "aSMA_SmoothMuscle",
        "CD235a_RBC",
        "CD45RB_Leukocyte",
        "CD3CD20_Lymphocyte",
        "ERG_Endothelium",
        "MIST1_PlasmaCell",
        "MNDA_MyeloidCell",
    }
    assert manifest.annotation_provenance.published_artifacts == [
        "H&E image",
        "binary IF-derived segmentation mask",
    ]
    assert manifest.annotation_provenance.unpublished_intermediate_artifacts == [
        "IF image",
        "DAPI image",
    ]
    assert sum(task.uses_dapi_nucleus_transfer for task in manifest.tasks) == 5


def test_metadata_only_verification_needs_no_source_files(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(source, "urlopen", pytest.fail)

    summary = verify_metadata_contract(PROJECT_DIR)

    assert summary["task_count"] == 8
    assert summary["artifact_reference_count"] == 317374
    assert summary["metadata_bytes"] == 22_351_340


def test_manifest_rejects_lost_task_or_changed_rights() -> None:
    payload = json.loads((PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"))
    payload["tasks"] = payload["tasks"][:-1]
    with pytest.raises(ValueError, match="eight antigen-specific tasks"):
        SourceManifest.model_validate(payload)

    payload = json.loads((PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"))
    payload["license"]["spdx_id"] = "CC-BY-4.0"
    with pytest.raises(ValueError):
        SourceManifest.model_validate(payload)


def test_index_preserves_source_roles_artifacts_coordinates_and_tumour_type(
    tmp_path: Path,
) -> None:
    payload = _fixture_manifest(tmp_path)
    _write_metadata(tmp_path, payload)

    metrics = index_metadata(tmp_path)

    records = [
        json.loads(line)
        for line in (tmp_path / "outputs/native-records.jsonl").read_text().splitlines()
    ]
    assert len(records) == 8
    first = records[0]
    assert first["source_task_id"] == "panCK_Epithelium"
    assert first["source_role"] == "train"
    assert first["source_slide_id"] == "001"
    assert first["source_slide_key"] == "panCK_Epithelium:001"
    assert first["published_tumour_type"] == "Publisher tumour 1"
    assert first["wsi_x"] == 100
    assert first["wsi_y"] == 200
    assert first["micrometers_per_pixel"] == 0.220818
    assert first["he_input"]["member_path"].endswith("_HE.png")
    assert first["annotation"]["artifact"]["member_path"].endswith("_mask.png")
    assert first["annotation"]["registered_to_artifact_ref"] == first["he_input"]["artifact_ref"]
    assert metrics["table_s2_task_fallbacks"] == {"ERG_Endothelium": ["006"]}


def test_index_rejects_inconsistent_pair_roles(tmp_path: Path) -> None:
    payload = _fixture_manifest(tmp_path)
    _write_metadata(tmp_path, payload)
    task = payload["tasks"][0]
    metadata_file = task["metadata"]["filename"]
    path = tmp_path / "data/metadata" / metadata_file
    path.write_text(path.read_text().replace("_mask.png,train", "_mask.png,test"))

    with pytest.raises(SourceDataError, match="inconsistent source roles"):
        index_metadata(tmp_path)
    assert not (tmp_path / "outputs/native-records.jsonl").exists()


def test_index_rejects_unknown_metadata_fields(tmp_path: Path) -> None:
    payload = _fixture_manifest(tmp_path)
    _write_metadata(tmp_path, payload)
    task = payload["tasks"][0]
    path = tmp_path / "data/metadata" / task["metadata"]["filename"]
    path.write_text("antigen,filename,split\n", encoding="utf-8")

    with pytest.raises(SourceDataError, match="unexpected SegPath metadata fields"):
        index_metadata(tmp_path)


def test_table_s2_rejects_invalid_workbook(tmp_path: Path) -> None:
    path = tmp_path / "table-s2.xlsx"
    path.write_bytes(b"not an xlsx")

    with pytest.raises(SourceDataError, match="not a readable publisher XLSX"):
        load_table_s2(path)


def test_acquire_metadata_requests_only_small_metadata_files(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    destinations: list[str] = []

    def fake_download(
        source_url: str,
        destination: Path,
        *,
        bytes_count: int,
        algorithm: str,
        checksum: str,
        expected_host: str,
    ) -> bool:
        del source_url, bytes_count, algorithm, checksum, expected_host
        destinations.append(destination.name)
        return True

    monkeypatch.setattr(source, "_download", fake_download)

    assert acquire_metadata(PROJECT_DIR) == 9
    assert "table-s2.xlsx" in destinations
    assert not any(name.endswith(".tar.gz") for name in destinations)


def test_artifact_acquisition_requires_explicit_305_gb_budget() -> None:
    with pytest.raises(SourceDataError, match="305525589629 bytes"):
        acquire_artifacts(PROJECT_DIR)


def test_artifact_acquisition_owns_all_eight_native_archives(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    destinations: list[str] = []

    def fake_download_source_file(_source: object, destination: Path) -> bool:
        destinations.append(destination.name)
        return True

    monkeypatch.setattr(source, "_download_source_file", fake_download_source_file)

    installed = acquire_artifacts(PROJECT_DIR, max_bytes=305_525_589_629)

    assert installed == 8
    assert len(destinations) == 8
    assert all(name.endswith(".tar.gz") for name in destinations)


def test_download_verifies_checksum_and_reuses_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = b"publisher metadata"
    destination = tmp_path / "metadata.csv"
    monkeypatch.setattr(source, "urlopen", lambda _request, **_kwargs: io.BytesIO(payload))

    installed = _download(
        "https://zenodo.org/metadata.csv",
        destination,
        bytes_count=len(payload),
        algorithm="md5",
        checksum=hashlib.md5(payload).hexdigest(),  # noqa: S324 - publisher checksum fixture.
        expected_host="zenodo.org",
    )

    assert installed
    assert destination.read_bytes() == payload
    monkeypatch.setattr(source, "urlopen", pytest.fail)
    assert not _download(
        "https://zenodo.org/metadata.csv",
        destination,
        bytes_count=len(payload),
        algorithm="md5",
        checksum=hashlib.md5(payload).hexdigest(),  # noqa: S324 - publisher checksum fixture.
        expected_host="zenodo.org",
    )


def test_download_removes_bad_partial_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    destination = tmp_path / "metadata.csv"
    monkeypatch.setattr(source, "urlopen", lambda _request, **_kwargs: io.BytesIO(b"wrong"))

    with pytest.raises(SourceDataError, match="pinned checksum"):
        _download(
            "https://zenodo.org/metadata.csv",
            destination,
            bytes_count=5,
            algorithm="md5",
            checksum=hashlib.md5(b"right").hexdigest(),  # noqa: S324
            expected_host="zenodo.org",
        )

    assert not destination.exists()
    assert not (tmp_path / ".metadata.csv.part").exists()


def test_source_allowlist_requires_exact_https_host() -> None:
    assert _source_allowed("https://zenodo.org/api/records/1", "zenodo.org")
    assert not _source_allowed("http://zenodo.org/api/records/1", "zenodo.org")
    assert not _source_allowed("https://attacker.example/zenodo.org", "zenodo.org")
    assert not _source_allowed("https://zenodo.org:444/api/records/1", "zenodo.org")
