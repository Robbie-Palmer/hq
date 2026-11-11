from __future__ import annotations

import csv
import json
import re
import zipfile
from pathlib import Path
from typing import Any, cast

from camelyon_roi_product.acquisition import _digest
from camelyon_roi_product.models import SourceContract
from camelyon_roi_product.product import PROJECT_DIR, ProductError, _read_json, _write_json

DATASET_ID = "camelyon-gigadb-100439-roi-v1"
SCALE = {
    "coordinate_space": "whole_slide_level_0",
    "coordinate_unit": "pixel",
    "axes": "X,Y",
    "physical_spacing": "embedded_in_pyramidal_tiff",
}

METADATA_FILE_NAMES = {
    "camelyon16_reference.csv": "reference.csv",
    "camelyon17_stage_labels.csv": "stage_labels.csv",
}


def _verify_freeze_inputs(metadata: Path, contract: SourceContract) -> None:
    for source in contract.metadata_sources:
        name = METADATA_FILE_NAMES.get(source.source_id, source.source_id)
        path = metadata / name
        if not path.is_file() or _digest(path, "sha256") != source.sha256:
            raise ProductError(f"freeze metadata differs from pinned source: {source.source_id}")
    for archive in contract.annotation_archives:
        name = f"{archive.challenge}_{archive.source_role}_lesion_annotations.zip"
        path = metadata / name
        if (
            not path.is_file()
            or path.stat().st_size != archive.bytes
            or _digest(path, "md5") != archive.md5
            or _digest(path, "sha256") != archive.sha256
        ):
            raise ProductError(f"freeze archive differs from pinned source: {archive.artifact_id}")


def _checksums(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        digest, name = line.split(maxsplit=1)
        values[name.removeprefix("*")] = digest
    return values


def _api_files(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return cast(list[dict[str, Any]], payload["data"]["data"])


def _csv_rows(path: Path) -> list[list[str]]:
    with path.open(encoding="utf-8", newline="") as source:
        return list(csv.reader(source))


def _annotation_members(path: Path) -> set[str]:
    with zipfile.ZipFile(path) as source:
        return {name for name in source.namelist() if name.endswith(".xml")}


def _artifact(
    *,
    artifact_id: str,
    challenge: str,
    source_role: str,
    path: str,
    api_file: dict[str, Any],
    md5: str,
    format_name: str,
    slide_ids: list[str],
) -> dict[str, object]:
    return {
        "artifact_id": artifact_id,
        "challenge": challenge,
        "source_role": source_role,
        "path": path,
        "source_url": api_file["url"],
        "bytes": api_file["file_size"],
        "md5": md5,
        "format": format_name,
        "contains_slide_ids": slide_ids,
    }


def _camelyon16(
    metadata: Path, files: list[dict[str, Any]]
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    checksums = _checksums(metadata / "camelyon16_checksums.md5")
    annotations = {
        **{
            Path(name).stem: ("camelyon16-training-lesion-annotations", name)
            for name in _annotation_members(metadata / "CAMELYON16_training_lesion_annotations.zip")
        },
        **{
            Path(name).stem: ("camelyon16-testing-lesion-annotations", name)
            for name in _annotation_members(metadata / "CAMELYON16_testing_lesion_annotations.zip")
        },
    }
    test_labels = {
        row[0]: {"slide_label": row[1], "lesion_category": row[3]}
        for row in _csv_rows(metadata / "reference.csv")
    }
    non_exhaustive = set(
        re.findall(
            r"^\* ((?:tumor|test)_\d{3})",
            (metadata / "camelyon16_readme.md").read_text(),
            re.M,
        )
    )
    artifacts: list[dict[str, object]] = []
    records: list[dict[str, object]] = []
    image_files = sorted(
        (file for file in files if "/CAMELYON16/" in file["url"] and file["url"].endswith(".tif")),
        key=lambda file: file["url"],
    )
    for file in image_files:
        source_path = file["url"].split("/CAMELYON16/", maxsplit=1)[1]
        slide_id = Path(source_path).stem
        source_role = "training" if source_path.startswith("training/") else "testing"
        artifact_id = f"camelyon16-{slide_id}-wsi"
        label = (
            {"slide_label": "Tumor", "lesion_category": "not_published"}
            if slide_id.startswith("tumor_")
            else {"slide_label": "Normal", "lesion_category": "None"}
        )
        if source_role == "testing":
            label = test_labels[slide_id]
        artifacts.append(
            _artifact(
                artifact_id=artifact_id,
                challenge="CAMELYON16",
                source_role=source_role,
                path=f"CAMELYON16/{source_path}",
                api_file=file,
                md5=checksums[source_path],
                format_name="pyramidal_tiff",
                slide_ids=[slide_id],
            )
        )
        annotation = annotations.get(slide_id)
        incomplete = slide_id in non_exhaustive
        records.append(
            {
                "schema_version": "1.0.0",
                "dataset_id": DATASET_ID,
                "record_id": f"CAMELYON16:{slide_id}",
                "challenge": "CAMELYON16",
                "source_role": source_role,
                "patient_id": None,
                "centre_id": None,
                "node_id": None,
                "slide_id": slide_id,
                "stain": "H&E",
                **label,
                "patient_stage": None,
                "identity_completeness": "not_published_for_camelyon16",
                "annotation_completeness": "non_exhaustive" if incomplete else "exhaustive",
                "annotation_completeness_detail": {
                    "all_tumor_areas": "non_exhaustive" if incomplete else "exhaustive"
                },
                "slide_artifact": {"artifact_id": artifact_id, "archive_member": None},
                "lesion_annotation": (
                    {
                        "artifact_id": annotation[0],
                        "archive_member": annotation[1],
                        "native_groups": ["_0", "_1", "_2"],
                    }
                    if annotation
                    else None
                ),
                "scale": SCALE,
            }
        )
    return artifacts, records


def _camelyon17(
    metadata: Path, files: list[dict[str, Any]]
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    checksums = _checksums(metadata / "camelyon17_checksums.md5")
    annotation_members = sorted(
        _annotation_members(metadata / "CAMELYON17_training_lesion_annotations.zip")
    )
    slide_ids = [Path(name).stem for name in annotation_members]
    patient_ids = sorted({slide_id.rsplit("_node_", maxsplit=1)[0] for slide_id in slide_ids})
    labels = {Path(row[0]).stem: row[1] for row in _csv_rows(metadata / "stage_labels.csv")[1:]}
    patient_files = {
        Path(file["file_name"]).stem: file
        for file in files
        if "/CAMELYON17/training/center_" in file["url"] and file["file_name"].endswith(".zip")
    }
    artifacts: list[dict[str, object]] = []
    centre_by_patient: dict[str, str] = {}
    for patient_id in patient_ids:
        file = patient_files[patient_id]
        source_path = file["url"].split("/CAMELYON17/", maxsplit=1)[1]
        centre_id = source_path.split("/")[1]
        centre_by_patient[patient_id] = centre_id
        contained = [f"{patient_id}_node_{index}" for index in range(5)]
        artifacts.append(
            _artifact(
                artifact_id=f"camelyon17-{patient_id}-slides",
                challenge="CAMELYON17",
                source_role="training",
                path=f"CAMELYON17/{source_path}",
                api_file=file,
                md5=checksums[source_path],
                format_name="patient_zip",
                slide_ids=contained,
            )
        )
    records: list[dict[str, object]] = []
    for member, slide_id in zip(annotation_members, slide_ids, strict=True):
        patient_id, node_index = slide_id.rsplit("_node_", maxsplit=1)
        records.append(
            {
                "schema_version": "1.0.0",
                "dataset_id": DATASET_ID,
                "record_id": f"CAMELYON17:{slide_id}",
                "challenge": "CAMELYON17",
                "source_role": "training",
                "patient_id": patient_id,
                "centre_id": centre_by_patient[patient_id],
                "node_id": f"node_{node_index}",
                "slide_id": slide_id,
                "stain": "H&E",
                "slide_label": labels[slide_id],
                "lesion_category": labels[slide_id],
                "patient_stage": labels[patient_id],
                "identity_completeness": "complete",
                "annotation_completeness": "non_exhaustive",
                "annotation_completeness_detail": {
                    "macro_metastases": "exhaustive",
                    "micro_metastases": "exhaustive",
                    "isolated_tumor_cells": "non_exhaustive",
                },
                "slide_artifact": {
                    "artifact_id": f"camelyon17-{patient_id}-slides",
                    "archive_member": f"{slide_id}.tif",
                },
                "lesion_annotation": {
                    "artifact_id": "camelyon17-training-lesion-annotations",
                    "archive_member": member,
                    "native_groups": ["metastases", "normal"],
                },
                "scale": SCALE,
            }
        )
    return artifacts, records


def freeze_snapshot(metadata_dir: str, root: str | None = None) -> None:
    metadata = Path(metadata_dir).resolve()
    target = Path(root).resolve() if root is not None else PROJECT_DIR
    contract = SourceContract.model_validate(_read_json(target / "contracts/source.json"))
    _verify_freeze_inputs(metadata, contract)
    files = _api_files(metadata / "gigadb_files.json")
    cam16_artifacts, cam16_records = _camelyon16(metadata, files)
    cam17_artifacts, cam17_records = _camelyon17(metadata, files)
    artifacts = cam16_artifacts + cam17_artifacts
    records = cam16_records + cam17_records
    if len(artifacts) != 442 or len(records) != 449:
        raise ProductError("official metadata produced unexpected CAMELYON scope")
    _write_json(
        target / "contracts/artifacts.json",
        {"schema_version": "1.0.0", "dataset_id": DATASET_ID, "artifacts": artifacts},
    )
    _write_json(
        target / "records/native-records.json",
        {"schema_version": "1.0.0", "dataset_id": DATASET_ID, "records": records},
    )
