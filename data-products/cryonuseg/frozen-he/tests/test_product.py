import csv
import hashlib
import io
import json
import shutil
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace, TracebackType
from urllib.parse import unquote

import pytest

from cryonuseg_source_data import source_check
from cryonuseg_source_data.models import GdcSlide, SourceContract
from cryonuseg_source_data.product import (
    ProductError,
    load_contract,
    load_gdc_slides,
    publish_product,
)

PROJECT_DIR = Path(__file__).resolve().parents[1]


def _copy_product_inputs(root: Path) -> None:
    for directory in ("contracts", "records", "sources"):
        shutil.copytree(PROJECT_DIR / directory, root / directory)


def _mutate_csv(
    root: Path, relative_path: str, mutate: Callable[[list[dict[str, str]]], None]
) -> None:
    path = root / relative_path
    with path.open(encoding="utf-8", newline="") as source:
        rows = list(csv.DictReader(source))
        fieldnames = list(rows[0])
    mutate(rows)
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def _gdc_hit(slide: GdcSlide) -> dict[str, object]:
    return {
        **slide.model_dump(
            exclude={
                "tcga_patient_barcode",
                "case_id",
                "project_id",
                "sample_submitter_id",
                "sample_type",
                "tissue_type",
                "portion_submitter_id",
                "slide_submitter_id",
            }
        ),
        "cases": [
            {
                "case_id": slide.case_id,
                "submitter_id": slide.tcga_patient_barcode,
                "project": {"project_id": slide.project_id},
                "samples": [
                    {
                        "submitter_id": slide.sample_submitter_id,
                        "sample_type": slide.sample_type,
                        "tissue_type": slide.tissue_type,
                        "portions": [
                            {
                                "submitter_id": slide.portion_submitter_id,
                                "slides": [{"submitter_id": slide.slide_submitter_id}],
                            }
                        ],
                    }
                ],
            }
        ],
    }


def test_publish_preserves_native_identity_annotations_and_missingness(tmp_path: Path) -> None:
    _copy_product_inputs(tmp_path)

    metrics = publish_product(tmp_path)

    assert metrics == {
        "annotation_release_counts": {
            "annotator-1-biologist-round-1": 7596,
            "annotator-1-biologist-round-2": 8044,
            "annotator-2-bioinformatician": 8251,
        },
        "annotation_roi_count": 23891,
        "archive_file_count": 24731,
        "artifact_note_count": 30,
        "dataset_id": "cryonuseg-kaggle-v7",
        "missing_scale_patch_count": 1,
        "organ_count": 10,
        "patch_count": 30,
        "patient_count": 30,
        "tissue_source_site_count": 30,
    }
    corpus = json.loads((tmp_path / "outputs/native-corpus.json").read_text(encoding="utf-8"))
    pancreas = next(
        patch for patch in corpus["patches"] if patch["patch_id"] == "Human_Pancreas_02"
    )
    assert pancreas["gdc_tissue_slide"]["file_id"] == "f8557c6f-6b3f-4392-8823-41cd5d953b6f"
    assert pancreas["gdc_tissue_slide"]["experimental_strategy"] == "Tissue Slide"
    assert pancreas["annotations"][0]["nucleus_count"] == 221
    assert pancreas["annotations"][1]["nucleus_count"] == 228
    assert pancreas["annotations"][2]["nucleus_count"] == 226
    assert pancreas["annotations"][0]["artifacts"]["imagej_roi_boundaries"].endswith(
        "Human_Pancreas_02_RoiSet/*.roi"
    )
    testes = next(patch for patch in corpus["patches"] if patch["patch_id"] == "Human_Testes_01")
    selected = testes["selected_wsis_metadata"]
    assert (selected["svs_width"], selected["svs_height"], selected["pixel_dimensions"]) == (
        None,
        None,
        None,
    )
    assert corpus["source_contract"]["annotations"]["consensus_available"] is False
    assert corpus["source_contract"]["annotations"]["default_release"] is None


def test_publish_rejects_duplicate_patient_identity(tmp_path: Path) -> None:
    _copy_product_inputs(tmp_path)

    def duplicate(rows: list[dict[str, str]]) -> None:
        rows[1]["tcga_patient_barcode"] = rows[0]["tcga_patient_barcode"]

    _mutate_csv(tmp_path, "records/selected-wsis.csv", duplicate)

    with pytest.raises(ProductError, match="patient identities must be unique"):
        publish_product(tmp_path)


def test_publish_rejects_partial_scale_missingness(tmp_path: Path) -> None:
    _copy_product_inputs(tmp_path)

    def remove_height(rows: list[dict[str, str]]) -> None:
        rows[0]["svs_height"] = ""

    _mutate_csv(tmp_path, "records/selected-wsis.csv", remove_height)

    with pytest.raises(ProductError, match="incomplete scale missingness"):
        publish_product(tmp_path)


def test_publish_rejects_changed_annotation_count(tmp_path: Path) -> None:
    _copy_product_inputs(tmp_path)

    def change_count(rows: list[dict[str, str]]) -> None:
        rows[0]["annotator_1_biologist_round_1_count"] = "86"

    _mutate_csv(tmp_path, "records/selected-wsis.csv", change_count)

    with pytest.raises(ProductError, match="annotation counts differ"):
        publish_product(tmp_path)


def test_source_contract_rejects_consensus_claim() -> None:
    payload = json.loads((PROJECT_DIR / "contracts/source.json").read_text(encoding="utf-8"))
    payload["annotations"]["consensus_available"] = True

    with pytest.raises(ValueError, match="consensus_available"):
        SourceContract.model_validate(payload)


def test_source_check_validates_publisher_and_gdc_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    contract = load_contract()

    def fetch_json(url: str) -> dict[str, object]:
        if url == str(contract.kaggle.metadata_api_url):
            return {
                "ref": contract.kaggle.dataset_ref,
                "currentVersionNumber": contract.kaggle.version,
                "lastUpdated": contract.kaggle.updated_at,
                "totalBytes": contract.kaggle.reported_total_bytes,
                "licenseName": contract.kaggle.license_label,
            }
        assert url == str(contract.github.commit_api_url)
        return {"sha": contract.github.commit}

    class Digest:
        def hexdigest(self) -> str:
            return contract.github.selected_wsis_sha256

    monkeypatch.setattr(source_check, "_fetch_json", fetch_json)
    monkeypatch.setattr(source_check, "_fetch_bytes", lambda _url: b"workbook")
    monkeypatch.setattr(source_check.hashlib, "sha256", lambda _payload=b"": Digest())
    monkeypatch.setattr(source_check, "_query_gdc", lambda expected: expected)

    assert source_check.check_sources() == {
        "gdc_slides_checked": 30,
        "github_revisions_checked": 1,
        "kaggle_versions_checked": 1,
        "selected_wsis_files_checked": 1,
    }


def test_source_check_rejects_changed_kaggle_version(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        source_check,
        "_fetch_json",
        lambda _url: {
            "ref": "ipateam/segmentation-of-nuclei-in-cryosectioned-he-images",
            "currentVersionNumber": 6,
            "lastUpdated": "2021-02-01T15:58:08.423Z",
            "totalBytes": 416431626,
            "licenseName": "MIT",
        },
    )

    with pytest.raises(ProductError, match="Kaggle metadata differs"):
        source_check.check_sources()


def test_gdc_source_projection_round_trips() -> None:
    slide = load_gdc_slides()[0]

    assert source_check._flatten_gdc_hit(_gdc_hit(slide)) == slide
    url = source_check._gdc_url([slide])
    assert url.startswith("https://api.gdc.cancer.gov/files?")
    assert slide.file_id in unquote(url)


def test_fetch_bytes_requires_https_and_bounded_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(ProductError, match="require HTTPS"):
        source_check._fetch_bytes("http://example.test/source")

    class Response(io.BytesIO):
        def __enter__(self) -> "Response":
            return self

        def __exit__(
            self,
            exc_type: type[BaseException] | None,
            exc_val: BaseException | None,
            exc_tb: TracebackType | None,
        ) -> None:
            del exc_type, exc_val, exc_tb
            self.close()

        def geturl(self) -> str:
            return "https://example.test/source"

    monkeypatch.setattr(
        source_check.urllib.request,
        "urlopen",
        lambda _request, **_kwargs: Response(b"too large"),
    )
    with pytest.raises(ProductError, match="bounded response size"):
        source_check._fetch_bytes("https://example.test/source", max_bytes=3)


def test_verify_archive_checks_bytes_and_sha256(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    archive = tmp_path / "archive.zip"
    archive.write_bytes(b"archive")
    expected = SimpleNamespace(
        archive=SimpleNamespace(
            compressed_bytes=archive.stat().st_size,
            sha256=hashlib.sha256(b"archive").hexdigest(),
        )
    )
    monkeypatch.setattr(source_check, "load_contract", lambda _root: expected)

    source_check.verify_archive(archive, tmp_path)
    archive.write_bytes(b"changed")
    with pytest.raises(ProductError, match="SHA-256 differs"):
        source_check.verify_archive(archive, tmp_path)
