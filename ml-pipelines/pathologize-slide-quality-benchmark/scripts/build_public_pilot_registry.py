from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import fire
import numpy as np
import openslide
from PIL import Image

from pathologize_slide_quality_pilot.pilot import _typed_annotation

BENCHMARK_ROOT = Path(__file__).resolve().parents[1]
REGISTRY_ROOT = BENCHMARK_ROOT.parent / "pathologize-data-registry"
SOURCE_INDEX = BENCHMARK_ROOT / "public-pilot/source-index.json"
PREDECLARATION = BENCHMARK_ROOT / "public-pilot/predeclaration.json"
RAW_ROOT = REGISTRY_ROOT / "data/raw/airaqc-tcga/public-pilot-v1"
COLLECTION_ID = "airaqc-tcga"
SUBSET_ID = "airaqc-tcga-public-pilot-v1"


def _read(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"{path} must contain a JSON object")
    return value


def _write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _slide_id(patient_id: str, source_id: str) -> str:
    return f"airaqc-tcga:{patient_id.lower()}:{source_id.lower()}"


def _labels(annotation_path: Path, declaration: dict[str, Any]) -> tuple[dict[str, int], bool]:
    image = np.asarray(Image.open(annotation_path).convert("RGB"))
    label_spec = declaration["labels"]
    _, counts = _typed_annotation(
        image,
        label_spec["palette_rgb"],
        float(label_spec["maximum_rgb_distance"]),
    )
    return counts, sum(counts.values()) > 0


def build() -> None:
    source_index = _read(SOURCE_INDEX)
    declaration = _read(PREDECLARATION)
    assets: list[dict[str, Any]] = []
    records: list[dict[str, Any]] = []
    corpus_slides: list[dict[str, Any]] = []
    slide_ids: list[str] = []
    total_bytes = 0
    for item in source_index["slides"]:
        slide_path = RAW_ROOT / "slides" / item["file_name"]
        annotation_path = RAW_ROOT / "annotations" / item["annotation_name"]
        if slide_path.stat().st_size != item["file_size"]:
            raise ValueError(f"slide byte count differs: {slide_path}")
        if annotation_path.stat().st_size != item["annotation_bytes"]:
            raise ValueError(f"annotation byte count differs: {annotation_path}")
        slide_sha256 = _sha256(slide_path)
        annotation_sha256 = _sha256(annotation_path)
        if annotation_sha256 != item["annotation_sha256"]:
            raise ValueError(f"annotation digest differs: {annotation_path}")
        with openslide.OpenSlide(slide_path) as slide:
            scanner_id = slide.properties.get("aperio.ScanScope ID")
            comment = slide.properties.get(openslide.PROPERTY_NAME_COMMENT, "")
            scanner_model = (
                "Leica SCN400"
                if scanner_id is None and "Leica SCN400" in comment
                else "Aperio ScanScope"
            )
            objective = float(slide.properties[openslide.PROPERTY_NAME_OBJECTIVE_POWER])
            mpp = float(slide.properties[openslide.PROPERTY_NAME_MPP_X])
            width, height = slide.dimensions
        stable_slide_id = _slide_id(item["patient_id"], item["file_id"])
        slide_ids.append(stable_slide_id)
        counts, reject = _labels(annotation_path, declaration)
        slide_asset = {
            "relative_path": f"slides/{item['file_name']}",
            "source_url": f"https://api.gdc.cancer.gov/data/{item['file_id']}",
            "bytes": item["file_size"],
            "sha256": slide_sha256,
            "source_md5": item["md5sum"],
            "source_identifier": item["file_id"],
            "format": "aperio_svs",
            "sop_instance_uid": None,
            "image_role": "whole_slide",
        }
        annotation_asset = {
            "relative_path": f"annotations/{item['annotation_name']}",
            "source_url": (
                "https://drive.usercontent.google.com/download"
                f"?id={item['annotation_file_id']}&export=download&confirm=t"
            ),
            "bytes": item["annotation_bytes"],
            "sha256": annotation_sha256,
            "source_etag": None,
            "source_md5": None,
            "source_identifier": item["annotation_file_id"],
            "format": "png_mask",
            "sop_instance_uid": None,
            "image_role": "artifact_annotation",
        }
        assets.extend([slide_asset, annotation_asset])
        total_bytes += item["file_size"] + item["annotation_bytes"]
        source_labels = [
            {
                "name": "project_id",
                "value": item["project_id"],
                "code": None,
                "coding_scheme": None,
                "coding_scheme_version": None,
                "provenance": "NCI GDC files API",
            },
            {
                "name": "artifact_status",
                "value": "defect" if reject else "clean",
                "code": None,
                "coding_scheme": None,
                "coding_scheme_version": None,
                "provenance": "AIRAQc annotation palette decoded by the predeclared rule",
            },
        ]
        source_labels.extend(
            {
                "name": "artifact_type",
                "value": name,
                "code": None,
                "coding_scheme": None,
                "coding_scheme_version": None,
                "provenance": "AIRAQc annotation palette decoded by the predeclared rule",
            }
            for name, count in counts.items()
            if count
        )
        records.append(
            {
                "schema_version": 1,
                "slide_id": stable_slide_id,
                "collection_id": COLLECTION_ID,
                "subset_id": SUBSET_ID,
                "identity": {
                    "patient_id": item["patient_id"],
                    "case_id": item["case_id"],
                    "specimen_id": item["slide_barcode"],
                    "specimen_uid": None,
                    "slide_container_id": item["slide_barcode"],
                    "study_instance_uid": None,
                    "series_instance_uid": None,
                    "identity_basis": (
                        "GDC case UUID and TCGA submitter ID identify the patient; the TCGA "
                        "slide barcode and GDC file UUID identify the slide asset."
                    ),
                },
                "scanner": {
                    "manufacturer": "Leica Biosystems",
                    "model": scanner_model,
                    "device_serial_number": scanner_id,
                    "objective_power": objective,
                    "conversion_note": "Native GDC Aperio SVS; no registry conversion.",
                },
                "physical_resolution": {
                    "micrometres_per_pixel_x": mpp,
                    "micrometres_per_pixel_y": mpp,
                    "total_pixel_matrix_columns": width,
                    "total_pixel_matrix_rows": height,
                    "source_instance_path": slide_asset["relative_path"],
                },
                "source_native_labels": source_labels,
                "label_limitations": (
                    "A clean label means no pixel matches the four released AIRAQc palette "
                    "classes. It does not prove that the slide has no unannotated defect."
                ),
                "asset_paths": [slide_asset["relative_path"], annotation_asset["relative_path"]],
            }
        )
        corpus_slides.append(
            {
                "slide_id": stable_slide_id,
                "patient_id": item["patient_id"],
                "case_id": item["case_id"],
                "project_id": item["project_id"],
                "scanner_id": scanner_id,
                "scanner_manufacturer": "Leica Biosystems",
                "scanner_model": scanner_model,
                "objective_power": objective,
                "micrometres_per_pixel": mpp,
                "source": {
                    "relative_path": slide_asset["relative_path"],
                    "source_url": slide_asset["source_url"],
                    "bytes": slide_asset["bytes"],
                    "sha256": slide_asset["sha256"],
                    "publisher_md5": slide_asset["source_md5"],
                    "publisher_id": slide_asset["source_identifier"],
                },
                "annotation": {
                    "relative_path": annotation_asset["relative_path"],
                    "source_url": annotation_asset["source_url"],
                    "bytes": annotation_asset["bytes"],
                    "sha256": annotation_asset["sha256"],
                    "publisher_md5": None,
                    "publisher_id": annotation_asset["source_identifier"],
                },
                "truth_reject": reject,
                "annotation_counts": counts,
            }
        )

    _write(
        REGISTRY_ROOT / "manifests/collections/airaqc-tcga.json",
        {
            "schema_version": 1,
            "collection_id": COLLECTION_ID,
            "title": "AIRAQc TCGA artifact test annotations and referenced GDC slides",
            "description": (
                "The 50 TCGA slides manually annotated for the AIRAQc MIDL 2025 test set, "
                "with a bounded 24-slide public-pilot subset."
            ),
            "registration_status": "acquired_subset",
            "source": {
                "publisher": "AIRA Matrix and the NCI Genomic Data Commons",
                "landing_page_url": "https://openreview.net/pdf?id=XNNsQqs1UP",
                "documentation_urls": [
                    "https://tinyurl.com/qctcga",
                    "https://docs.gdc.cancer.gov/API/Users_Guide/Getting_Started/",
                    "https://zenodo.org/records/22932961",
                ],
                "doi": None,
                "source_version": "AIRAQc MIDL 2025 linked release; GDC files resolved 2026-11-07",
                "retrieved_at": "2026-11-07",
            },
            "access": {
                "public": True,
                "authentication_required": False,
                "automated_access": True,
                "acquisition_policy": "automated_bounded",
                "reason": (
                    "The authors link the annotations for public benchmarking and GDC exposes "
                    "the referenced TCGA slides without authentication."
                ),
                "download_base_urls": [
                    "https://api.gdc.cancer.gov/data/",
                    "https://drive.usercontent.google.com/",
                ],
            },
            "license": {
                "name": "CC BY 4.0 paper with a separately linked annotation release",
                "spdx_id": "LicenseRef-AIRAQc-TCGA-Public-Research",
                "url": "https://openreview.net/pdf?id=XNNsQqs1UP",
                "scope": (
                    "The paper is CC BY 4.0 and explicitly links the annotation release. The "
                    "Google Drive folder has no standalone licence file. GDC labels the slides "
                    "open access."
                ),
                "redistribution": (
                    "Do not redistribute slide or annotation bytes from this registry. Public "
                    "pilot artifacts are limited to identifiers, checksums, and numeric results."
                ),
            },
            "citation": (
                "Gautam, K., Raipuria, G., and Singhal, N. AIRAQc: Pre-Analytical Tool for "
                "Accurate Identification and Quantification of Artefacts in Histopathology. "
                "MIDL short papers (2025)."
            ),
            "known_scale": {
                "slides_or_series": 50,
                "bytes": source_index["known_slide_bytes"],
                "basis": (
                    "Fifty linked GDC slide filenames resolved through the GDC files API on "
                    "2026-11-07; byte total excludes the small annotation image files."
                ),
            },
            "source_native_label_domains": [
                "four-class artifact annotation",
                "artifact-free slide status",
                "TCGA project membership",
            ],
            "subsets": [SUBSET_ID],
        },
    )
    _write(
        REGISTRY_ROOT / "manifests/subsets/airaqc-tcga-public-pilot-v1.json",
        {
            "schema_version": 1,
            "subset_id": SUBSET_ID,
            "collection_id": COLLECTION_ID,
            "description": (
                "The fixed 24-slide test partition from the cited v1.0.1 reliability deposit."
            ),
            "selection": {
                "method": (
                    "Use test_slides verbatim from Moutselos and Maglogiannis Zenodo v1.0.1 "
                    "before inspecting deterministic feature outcomes."
                ),
                "source_index_version": "10.5281/zenodo.22932961 v1.0.1",
                "selected_at": "2026-11-07",
                "task_split": None,
            },
            "asset_root": "data/raw/airaqc-tcga/public-pilot-v1",
            "asset_manifest_id": "airaqc-tcga-public-pilot-v1-assets",
            "slide_ids": slide_ids,
            "asset_count": len(assets),
            "total_bytes": total_bytes,
        },
    )
    _write(
        REGISTRY_ROOT / "manifests/assets/airaqc-tcga-public-pilot-v1.json",
        {
            "schema_version": 1,
            "asset_manifest_id": "airaqc-tcga-public-pilot-v1-assets",
            "subset_id": SUBSET_ID,
            "assets": assets,
        },
    )
    record_paths: list[str] = []
    for record in records:
        source_id = record["slide_id"].split(":")[-1]
        relative_path = f"records/slides/airaqc-tcga-{source_id}.json"
        record_paths.append(relative_path)
        _write(REGISTRY_ROOT / relative_path, record)
    registry_index = _read(REGISTRY_ROOT / "registry.json")
    additions = {
        "collections": ["manifests/collections/airaqc-tcga.json"],
        "subsets": ["manifests/subsets/airaqc-tcga-public-pilot-v1.json"],
        "asset_manifests": ["manifests/assets/airaqc-tcga-public-pilot-v1.json"],
        "slide_records": record_paths,
    }
    for field, paths in additions.items():
        registry_index[field] = sorted(set(registry_index[field]) | set(paths))
    _write(REGISTRY_ROOT / "registry.json", registry_index)
    collection_manifest = REGISTRY_ROOT / "manifests/collections/airaqc-tcga.json"
    subset_manifest = REGISTRY_ROOT / "manifests/subsets/airaqc-tcga-public-pilot-v1.json"
    asset_manifest = REGISTRY_ROOT / "manifests/assets/airaqc-tcga-public-pilot-v1.json"
    _write(
        BENCHMARK_ROOT / "public-pilot/corpus.json",
        {
            "schema_version": "1.0.0",
            "corpus_id": "airaqc-tcga-public-pilot-v1",
            "registry_base_revision": source_index["base_revision"],
            "registry_subset_id": SUBSET_ID,
            "registry_index_sha256": _sha256(REGISTRY_ROOT / "registry.json"),
            "registry_collection_manifest_sha256": _sha256(collection_manifest),
            "registry_subset_manifest_sha256": _sha256(subset_manifest),
            "registry_asset_manifest_sha256": _sha256(asset_manifest),
            "source_index_sha256": _sha256(SOURCE_INDEX),
            "source_root": "../pathologize-data-registry/data/raw/airaqc-tcga/public-pilot-v1",
            "slides": corpus_slides,
            "exclusions": source_index["exclusions"],
            "failed_acquisitions": source_index["failed_acquisitions"],
            "provenance": source_index["provenance"],
        },
    )
    print(f"Wrote {len(records)} slide records and {len(assets)} pinned source assets.")


def main() -> None:
    fire.Fire({"build": build})


if __name__ == "__main__":
    main()
