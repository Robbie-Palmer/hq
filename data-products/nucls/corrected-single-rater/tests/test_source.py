import hashlib
import io
import json
import urllib.request
import zipfile
from http.client import HTTPMessage
from pathlib import Path

import pytest

from nucls_source_data.models import SourceManifest
from nucls_source_data.source import (
    SourceDataError,
    _HttpsOnlyRedirectHandler,
    acquire_dataset,
    index_dataset,
    load_annotations,
)

PROJECT_DIR = Path(__file__).resolve().parents[1]


def _zip_bytes(name: str, content: bytes) -> bytes:
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w") as archive:
        archive.writestr(name, content)
    return target.getvalue()


def _write_native_fixture(root: Path) -> None:
    (root / "manifest.json").write_text(
        (PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"), encoding="utf-8"
    )
    data = root / "data/native"
    (data / "rgb").mkdir(parents=True)
    (data / "annotations").mkdir()
    (data / "splits").mkdir()
    item_id = "TCGA-AA-0001-DX1_id-0"
    (data / "rgb" / f"{item_id}.png").write_bytes(b"fixture")
    rows = [
        "raw_classification,main_classification,super_classification,type,xmin,ymin,xmax,ymax,coords_x,coords_y",
        "a,a,nonTIL_stromal,rectangle,1,2,3,4,,",
        'a,a,sTIL,polyline,1,2,3,4,"1,2,3","2,3,4"',
        "a,a,tumor_any,point,1,2,1,2,1,2",
        "a,a,AMBIGUOUS,rectangle,1,2,3,4,,",
        "a,a,other_nucleus,rectangle,1,2,3,4,,",
    ]
    (data / "annotations" / f"{item_id}.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")
    split = ",slide_name,hospital,type,fold\n0,TCGA-AA-0001-DX1,AA,test,1\n"
    (data / "splits/fold_1_test.csv").write_text(split, encoding="utf-8")


def test_index_preserves_native_labels_roles_and_coordinates(tmp_path: Path) -> None:
    _write_native_fixture(tmp_path)

    metrics = index_dataset(tmp_path)

    record = json.loads((tmp_path / "outputs/native-index.jsonl").read_text(encoding="utf-8"))
    assert record["patient_id"] == "TCGA-AA-0001"
    assert record["source_roles"] == {"1": "test"}
    assert record["source_labels_present"] == [
        "AMBIGUOUS",
        "nonTIL_stromal",
        "other_nucleus",
        "sTIL",
        "tumor_any",
    ]
    assert record["source_ontology_labels_present"] == {
        "main_classification": ["a"],
        "raw_classification": ["a"],
        "super_classification": record["source_labels_present"],
    }
    native_ontology_counts = metrics["native_ontology_counts"]
    assert isinstance(native_ontology_counts, dict)
    assert native_ontology_counts["raw_classification"] == {"a": 5}
    assert metrics["annotation_type_counts"] == {"point": 1, "polyline": 1, "rectangle": 3}
    annotation = load_annotations(tmp_path / record["annotation_path"])[1]
    assert annotation.coordinates_x == (1, 2, 3)
    assert annotation.center == (2.0, 3.0)


def test_source_contract_rejects_duplicate_native_label() -> None:
    payload = json.loads((PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"))
    payload["unmappable_categories"]["sTIL"] = "duplicate"

    with pytest.raises(ValueError, match="native labels must be unique"):
        SourceManifest.model_validate(payload)


def test_annotation_parser_rejects_unknown_geometry(tmp_path: Path) -> None:
    path = tmp_path / "annotations.csv"
    path.write_text(
        "raw_classification,main_classification,super_classification,type,xmin,ymin,xmax,ymax,coords_x,coords_y\na,a,sTIL,circle,1,2,3,4,,\n",
        encoding="utf-8",
    )

    with pytest.raises(SourceDataError, match="unknown NuCLS annotation type"):
        load_annotations(path)


def test_acquisition_verifies_extracts_and_reuses_output(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    contents = {
        "rgb": _zip_bytes("rgb/item.png", b"png"),
        "annotations": _zip_bytes("csv/item.csv", b"header\n"),
        "splits": _zip_bytes("train_test_splits/fold_1_test.csv", b"header\n"),
    }
    manifest = json.loads((PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"))
    for archive in manifest["archives"]:
        value = contents[archive["name"]]
        archive.update(
            {
                "url": f"https://example.test/{archive['name']}.zip",
                "bytes": len(value),
                "md5": hashlib.md5(value).hexdigest(),  # noqa: S324 - pinned source evidence.
                "sha256": hashlib.sha256(value).hexdigest(),
            }
        )
    (tmp_path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    class FakeOpener:
        def open(self, request: urllib.request.Request, timeout: int) -> io.BytesIO:
            assert timeout == 60
            return io.BytesIO(contents[Path(request.full_url).stem])

    monkeypatch.setattr(urllib.request, "build_opener", lambda *_: FakeOpener())

    evidence = acquire_dataset(tmp_path)

    assert len(evidence.archives) == 3
    assert (tmp_path / "data/native/rgb/item.png").read_bytes() == b"png"
    assert acquire_dataset(tmp_path) == evidence


def test_acquisition_cleans_failed_output(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    (tmp_path / "manifest.json").write_text(
        (PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"), encoding="utf-8"
    )

    class FailingOpener:
        def open(self, request: urllib.request.Request, timeout: int) -> io.BytesIO:
            del request, timeout
            raise OSError("download failed")

    monkeypatch.setattr(urllib.request, "build_opener", lambda *_: FailingOpener())

    with pytest.raises(OSError, match="download failed"):
        acquire_dataset(tmp_path)
    assert not (tmp_path / "data/native").exists()


def test_redirect_handler_rejects_non_https_destination() -> None:
    handler = _HttpsOnlyRedirectHandler()

    with pytest.raises(SourceDataError, match="redirect must use HTTPS"):
        handler.redirect_request(
            urllib.request.Request("https://example.test/archive.zip"),
            io.BytesIO(),
            302,
            "Found",
            HTTPMessage(),
            "http://example.test/archive.zip",
        )
