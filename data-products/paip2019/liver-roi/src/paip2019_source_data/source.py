from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any, Literal, cast

import tifffile
from defusedxml import ElementTree

from paip2019_source_data.models import (
    ArtifactEvidence,
    ImageGeometry,
    NativeCaseReceipt,
    NativeCaseRecord,
    SlideScale,
    SourceManifest,
    XmlRegionCounts,
)

PROJECT_DIR = Path(__file__).resolve().parents[2]
APP_MAG_PATTERN = re.compile(r"(?:^|\|)AppMag\s*=\s*([0-9.]+)(?:\||$)")
MPP_PATTERN = re.compile(r"(?:^|\|)MPP\s*=\s*([0-9.]+)(?:\||$)")
CoordinateFrame = Literal["aperio_svs_level_0_pixels", "publisher_binary_mask_raster"]


class SourceDataError(RuntimeError):
    pass


def load_manifest(root: Path = PROJECT_DIR) -> SourceManifest:
    return SourceManifest.model_validate_json((root / "manifest.json").read_text(encoding="utf-8"))


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def publish_contract(root: Path = PROJECT_DIR) -> dict[str, object]:
    manifest = load_manifest(root)
    payload = manifest.model_dump(mode="json")
    role_counts = {item.role: item.case_count for item in manifest.publisher_roles}
    metrics: dict[str, object] = {
        "annotated_training_case_count": role_counts["training"],
        "case_count": sum(role_counts.values()),
        "dataset_id": manifest.dataset_id,
        "publisher_role_counts": role_counts,
        "released_ground_truth_case_count": role_counts["training"],
        "withheld_ground_truth_case_count": role_counts["validation"] + role_counts["test"],
    }
    _write_json(root / "outputs/source-contract.json", payload)
    _write_json(root / "outputs/source-metrics.json", metrics)
    return metrics


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _resolve_artifact(root: Path, relative: str) -> Path:
    path = (root / relative).resolve(strict=True)
    try:
        path.relative_to(root.resolve())
    except ValueError as error:
        raise SourceDataError(f"artifact escapes the source product: {relative}") from error
    if not path.is_file():
        raise SourceDataError(f"artifact is not a regular file: {relative}")
    return path


def _tiff_metadata(
    path: Path, coordinate_frame: CoordinateFrame
) -> tuple[ImageGeometry, float | None]:
    with tifffile.TiffFile(path) as image:
        page = image.pages[0]
        height, width = cast(tuple[int, int], page.shape[:2])
        description = cast(Any, page).description or ""
    mpp_match = MPP_PATTERN.search(description)
    app_mag_match = APP_MAG_PATTERN.search(description)
    if app_mag_match is not None and float(app_mag_match.group(1)) != 20:
        raise SourceDataError(f"{path.name}: SVS AppMag differs from publisher 20x metadata")
    mpp = float(mpp_match.group(1)) if mpp_match is not None else None
    return (
        ImageGeometry(width=width, height=height, coordinate_frame=coordinate_frame),
        mpp,
    )


def _artifact(
    root: Path,
    case_id: str,
    kind: str,
    relative: str,
    format_name: str,
    coordinate_frame: CoordinateFrame | None,
) -> tuple[ArtifactEvidence, float | None]:
    path = _resolve_artifact(root, relative)
    geometry = None
    mpp = None
    if coordinate_frame is not None:
        geometry, mpp = _tiff_metadata(path, coordinate_frame)
    evidence = ArtifactEvidence.model_validate(
        {
            "artifact_ref": f"paip2019:{case_id}:{kind}",
            "kind": kind,
            "path": relative,
            "bytes": path.stat().st_size,
            "sha256": _sha256(path),
            "format": format_name,
            "geometry": geometry,
        }
    )
    return evidence, mpp


def _negative_roa(value: str | None) -> bool:
    return value is not None and value.strip().lower() in {"1", "true"}


def _xml_regions(path: Path) -> XmlRegionCounts:
    counts: Counter[str] = Counter()
    root = ElementTree.parse(path).getroot()
    for annotation in root.iter():
        if annotation.tag.rsplit("}", 1)[-1].lower() != "annotation":
            continue
        annotation_id = annotation.attrib.get("Id") or annotation.attrib.get("id")
        for region in annotation.iter():
            if region.tag.rsplit("}", 1)[-1].lower() != "region":
                continue
            negative = _negative_roa(
                region.attrib.get("NegativeROA")
                or region.attrib.get("NegativeRoa")
                or annotation.attrib.get("NegativeROA")
            )
            if annotation_id == "1" and not negative:
                counts["whole_tumor_area"] += 1
            elif annotation_id == "2" and not negative:
                counts["viable_tumor_area"] += 1
            elif annotation_id == "2" and negative:
                counts["negative_pen_region"] += 1
    if counts["whole_tumor_area"] == 0 or counts["viable_tumor_area"] == 0:
        raise SourceDataError(f"{path.name}: XML lacks whole-tumour or viable-tumour regions")
    return XmlRegionCounts(
        coordinate_frame="aperio_imagescope_slide_coordinates",
        whole_tumor_area=counts["whole_tumor_area"],
        viable_tumor_area=counts["viable_tumor_area"],
        negative_pen_region=counts["negative_pen_region"],
    )


def _record(root: Path, manifest: SourceManifest, receipt: NativeCaseReceipt) -> NativeCaseRecord:
    slide, mpp = _artifact(
        root,
        receipt.case_id,
        "whole_slide",
        receipt.slide_path,
        "svs",
        "aperio_svs_level_0_pixels",
    )
    artifacts = [slide]
    xml_regions = None
    if receipt.source_role == "training":
        xml_path = cast(str, receipt.xml_annotation_path)
        whole_mask_path = cast(str, receipt.whole_tumor_mask_path)
        viable_mask_path = cast(str, receipt.viable_tumor_mask_path)
        xml, _ = _artifact(
            root,
            receipt.case_id,
            "xml_annotation",
            xml_path,
            "xml",
            None,
        )
        whole, _ = _artifact(
            root,
            receipt.case_id,
            "whole_tumor_mask",
            whole_mask_path,
            "tif",
            "publisher_binary_mask_raster",
        )
        viable, _ = _artifact(
            root,
            receipt.case_id,
            "viable_tumor_mask",
            viable_mask_path,
            "tif",
            "publisher_binary_mask_raster",
        )
        artifacts.extend((xml, whole, viable))
        xml_regions = _xml_regions(_resolve_artifact(root, xml_path))
    return NativeCaseRecord(
        dataset_id=manifest.dataset_id,
        record_ref=f"paip2019:{receipt.case_id}",
        case_id=receipt.case_id,
        slide_id=receipt.slide_id,
        source_role=receipt.source_role,
        institution_id=receipt.institution_id,
        stain=manifest.imaging.stain,
        scanner=manifest.imaging.scanner,
        slide_scale=SlideScale(
            nominal_magnification=manifest.imaging.nominal_magnification,
            micrometres_per_pixel_x=mpp,
            micrometres_per_pixel_y=mpp,
            basis="publisher_nominal_magnification_and_svs_metadata",
        ),
        artifacts=artifacts,
        xml_regions=xml_regions,
        publisher_measurements=receipt.publisher_measurements,
    )


def _load_receipts(path: Path) -> list[NativeCaseReceipt]:
    receipts: list[NativeCaseReceipt] = []
    with path.open(encoding="utf-8") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            try:
                receipts.append(NativeCaseReceipt.model_validate_json(line))
            except ValueError as error:
                raise SourceDataError(f"{path}:{line_number}: invalid source receipt") from error
    if not receipts:
        raise SourceDataError("source receipt contains no cases")
    return receipts


def index_native_release(
    root: Path = PROJECT_DIR,
    *,
    receipt_path: Path | None = None,
    output_root: Path | None = None,
    require_complete: bool = True,
) -> dict[str, object]:
    manifest = load_manifest(root)
    receipts = _load_receipts(receipt_path or root / "data/native/source-receipt.jsonl")
    case_ids = [item.case_id for item in receipts]
    slide_ids = [item.slide_id for item in receipts]
    if len(case_ids) != len(set(case_ids)) or len(slide_ids) != len(set(slide_ids)):
        raise SourceDataError("publisher case and slide IDs must be unique")
    role_counts = Counter(item.source_role for item in receipts)
    expected_counts = {item.role: item.case_count for item in manifest.publisher_roles}
    if require_complete and dict(role_counts) != expected_counts:
        raise SourceDataError("source receipt role counts differ from the 50/10/40 release")
    records = [_record(root, manifest, receipt) for receipt in receipts]
    artifact_counts = Counter(artifact.kind for record in records for artifact in record.artifacts)
    metrics: dict[str, object] = {
        "artifact_counts": dict(sorted(artifact_counts.items())),
        "case_count": len(records),
        "dataset_id": manifest.dataset_id,
        "publisher_role_counts": dict(sorted(role_counts.items())),
        "records_with_case_level_institution": sum(
            record.institution_id is not None for record in records
        ),
        "records_with_negative_pen_regions": sum(
            record.xml_regions is not None and record.xml_regions.negative_pen_region > 0
            for record in records
        ),
        "records_with_svs_mpp": sum(
            record.slide_scale.micrometres_per_pixel_x is not None for record in records
        ),
    }
    destination = output_root or root / "outputs/private"
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "native-index.jsonl").write_text(
        "".join(
            json.dumps(record.model_dump(mode="json"), sort_keys=True) + "\n" for record in records
        ),
        encoding="utf-8",
    )
    _write_json(destination / "source-metrics.json", metrics)
    return metrics
