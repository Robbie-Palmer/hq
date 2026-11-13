from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from cryonuseg_source_data.models import GdcSlide, SelectedWSI, SourceContract

PROJECT_DIR = Path(__file__).resolve().parents[2]
EXPECTED_ORGAN_TOKENS = {
    "AdrenalGland",
    "Larynx",
    "LymphNodes",
    "Mediastinum",
    "Pancreas",
    "Pleura",
    "Skin",
    "Testes",
    "Thymus",
    "ThyroidGland",
}


class ProductError(RuntimeError):
    pass


def _read_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ProductError(f"{path} must contain a JSON object")
    return payload


def load_contract(root: Path = PROJECT_DIR) -> SourceContract:
    return SourceContract.model_validate(_read_object(root / "contracts/source.json"))


def _optional_values(row: dict[str, str]) -> dict[str, str | None]:
    return {key: value if value != "" else None for key, value in row.items()}


def _read_csv[ModelT: BaseModel](path: Path, model: type[ModelT]) -> list[ModelT]:
    with path.open(encoding="utf-8", newline="") as source:
        return [model.model_validate(_optional_values(row)) for row in csv.DictReader(source)]


def load_selected_wsis(root: Path = PROJECT_DIR) -> list[SelectedWSI]:
    return _read_csv(root / "records/selected-wsis.csv", SelectedWSI)


def load_gdc_slides(root: Path = PROJECT_DIR) -> list[GdcSlide]:
    return _read_csv(root / "sources/gdc-tissue-slides.csv", GdcSlide)


def _organ_token(patch_id: str) -> str:
    return patch_id.removeprefix("Human_").rsplit("_", 1)[0]


def _require_unique(values: list[str], label: str) -> None:
    if len(values) != len(set(values)):
        raise ProductError(f"{label} must be unique")


def _validate_scale(record: SelectedWSI) -> bool:
    width = record.svs_width
    height = record.svs_height
    pixel_dimensions = record.pixel_dimensions
    if width is None or height is None or pixel_dimensions is None:
        if width is None and height is None and pixel_dimensions is None:
            return True
        raise ProductError(f"{record.patch_id}: incomplete scale missingness")
    if record.centroid_x + 256 > width or record.centroid_y + 256 > height:
        raise ProductError(f"{record.patch_id}: patch center falls outside source slide")
    return False


def _validate_organwise_counts(record: SelectedWSI) -> bool:
    organwise = (
        record.organwise_annotator_2_bioinformatician_count,
        record.organwise_annotator_1_biologist_round_1_count,
        record.organwise_annotator_1_biologist_round_2_count,
    )
    if not any(value is not None for value in organwise):
        return False
    if not all(value is not None for value in organwise):
        raise ProductError(f"{record.patch_id}: incomplete organwise counts")
    return True


def _validate_record(record: SelectedWSI) -> tuple[bool, bool]:
    if record.bit_depth != 8 or record.magnification != 40:
        raise ProductError(f"{record.patch_id}: native bit depth or magnification differs")
    if record.tissue_source_site != record.tcga_patient_barcode.split("-")[1]:
        raise ProductError(f"{record.patch_id}: tissue source site differs from TCGA barcode")
    if record.image_file_name != f"{record.patch_id}.tif":
        raise ProductError(f"{record.patch_id}: native image identity differs")
    return _validate_scale(record), _validate_organwise_counts(record)


def _validate_record_set(records: list[SelectedWSI], slides: list[GdcSlide]) -> None:
    if len(records) != 30 or len(slides) != 30:
        raise ProductError("CryoNuSeg must contain 30 patch and GDC records")
    _require_unique([record.patch_id for record in records], "patch identities")
    _require_unique([record.tcga_patient_barcode for record in records], "patient identities")
    _require_unique([record.tissue_source_site for record in records], "tissue source sites")
    _require_unique([slide.file_id for slide in slides], "GDC file identities")
    if Counter(_organ_token(record.patch_id) for record in records) != Counter(
        dict.fromkeys(EXPECTED_ORGAN_TOKENS, 3)
    ):
        raise ProductError("CryoNuSeg must retain three patches for each native organ token")

    slides_by_patient = {slide.tcga_patient_barcode: slide for slide in slides}
    if set(slides_by_patient) != {record.tcga_patient_barcode for record in records}:
        raise ProductError("GDC source patients differ from Selected_WSIs")

    missing_scale: list[str] = []
    organwise_rows: Counter[str] = Counter()
    for record in records:
        scale_is_missing, has_organwise_counts = _validate_record(record)
        if scale_is_missing:
            missing_scale.append(record.patch_id)
        if has_organwise_counts:
            organwise_rows[_organ_token(record.patch_id)] += 1

    if missing_scale != ["Human_Testes_01"]:
        raise ProductError("Selected_WSIs scale missingness differs from the publisher workbook")
    if organwise_rows != Counter(dict.fromkeys(EXPECTED_ORGAN_TOKENS, 1)):
        raise ProductError("Selected_WSIs must retain one organwise summary row per organ")


def _annotation_count(record: SelectedWSI, release_id: str) -> int:
    return {
        "annotator-1-biologist-round-1": record.annotator_1_biologist_round_1_count,
        "annotator-1-biologist-round-2": record.annotator_1_biologist_round_2_count,
        "annotator-2-bioinformatician": record.annotator_2_bioinformatician_count,
    }[release_id]


def _record_payload(
    record: SelectedWSI, slide: GdcSlide, contract: SourceContract
) -> dict[str, object]:
    releases: list[dict[str, object]] = []
    for release in contract.annotations.releases:
        artifact_paths = {
            family.artifact_id: (f"{release.archive_root}/{family.native_path_template}").format(
                patch_id=record.patch_id
            )
            for family in contract.annotations.artifact_families
        }
        releases.append(
            {
                "release_id": release.release_id,
                "annotator_role": release.annotator_role,
                "round": release.round,
                "nucleus_count": _annotation_count(record, release.release_id),
                "artifacts": artifact_paths,
            }
        )
    return {
        "schema_version": "1.0.0",
        "dataset_id": contract.dataset_id,
        "patch_id": record.patch_id,
        "organ_token": _organ_token(record.patch_id),
        "image_path": f"tissue images/{record.image_file_name}",
        "patch_pixels": {"width": 512, "height": 512},
        "selected_wsis_metadata": record.model_dump(mode="json"),
        "gdc_tissue_slide": slide.model_dump(mode="json"),
        "annotations": releases,
    }


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def publish_product(root: Path = PROJECT_DIR) -> dict[str, object]:
    contract = load_contract(root)
    records = load_selected_wsis(root)
    slides = load_gdc_slides(root)
    _validate_record_set(records, slides)
    slides_by_patient = {slide.tcga_patient_barcode: slide for slide in slides}

    release_totals = {
        release.release_id: sum(_annotation_count(record, release.release_id) for record in records)
        for release in contract.annotations.releases
    }
    declared_totals = {
        release.release_id: release.roi_count for release in contract.annotations.releases
    }
    if release_totals != declared_totals:
        raise ProductError("per-patch annotation counts differ from the archive inventory")

    corpus = {
        "schema_version": "1.0.0",
        "corpus_id": contract.dataset_id,
        "source_contract": contract.model_dump(mode="json"),
        "patches": [
            _record_payload(record, slides_by_patient[record.tcga_patient_barcode], contract)
            for record in records
        ],
    }
    metrics: dict[str, object] = {
        "dataset_id": contract.dataset_id,
        "patch_count": len(records),
        "organ_count": len({_organ_token(record.patch_id) for record in records}),
        "patient_count": len({record.tcga_patient_barcode for record in records}),
        "tissue_source_site_count": len({record.tissue_source_site for record in records}),
        "annotation_release_counts": dict(sorted(release_totals.items())),
        "annotation_roi_count": sum(release_totals.values()),
        "archive_file_count": contract.archive_inventory.total_files,
        "missing_scale_patch_count": sum(record.svs_width is None for record in records),
        "artifact_note_count": sum(bool(record.artifact_note) for record in records),
    }
    _write_json(root / "outputs/native-corpus.json", corpus)
    _write_json(root / "outputs/metrics.json", metrics)
    return metrics
