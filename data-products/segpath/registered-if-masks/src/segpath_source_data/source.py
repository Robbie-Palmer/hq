from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import shutil
from collections import Counter, defaultdict
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Literal, cast
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from zipfile import BadZipFile, ZipFile

from defusedxml import ElementTree

from segpath_source_data.models import (
    AnnotationReference,
    ArtifactReference,
    NativeRecord,
    SourceFile,
    SourceManifest,
    SourceRole,
    SourceTask,
)

PROJECT_DIR = Path(__file__).resolve().parents[2]
_XLSX_NAMESPACE = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


class SourceDataError(RuntimeError):
    pass


@dataclass(frozen=True)
class TableS2Row:
    tma_number: int
    tumour_type: str
    antibody_target: str


@dataclass(frozen=True)
class MetadataAsset:
    member_path: str
    source_role: SourceRole


def load_manifest(root: Path = PROJECT_DIR) -> SourceManifest:
    return SourceManifest.model_validate_json((root / "manifest.json").read_text(encoding="utf-8"))


def _digest(path: Path, algorithm: str) -> str:
    digest = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _source_allowed(source_url: str, expected_host: str) -> bool:
    source = urlsplit(source_url)
    return source.scheme == "https" and source.hostname == expected_host and source.port is None


def _require_file(path: Path, *, bytes_count: int, algorithm: str, checksum: str) -> None:
    if path.is_symlink() or not path.is_file():
        raise SourceDataError(f"source artifact is not a regular file: {path}")
    if path.stat().st_size != bytes_count or _digest(path, algorithm) != checksum:
        raise SourceDataError(f"source artifact differs from its pinned checksum: {path.name}")


def _download(
    source_url: str,
    destination: Path,
    *,
    bytes_count: int,
    algorithm: str,
    checksum: str,
    expected_host: str,
) -> bool:
    if destination.exists():
        try:
            _require_file(
                destination,
                bytes_count=bytes_count,
                algorithm=algorithm,
                checksum=checksum,
            )
        except SourceDataError:
            destination.unlink(missing_ok=True)
        else:
            return False
    if not _source_allowed(source_url, expected_host):
        raise SourceDataError(f"source URL is not allowlisted: {source_url}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.part")
    temporary.unlink(missing_ok=True)
    request = Request(  # noqa: S310 - the manifest model and host check constrain this URL.
        source_url,
        headers={"User-Agent": "segpath-source-data/0.1 (+data-product)"},
    )
    try:
        with closing(urlopen(request, timeout=120)) as response, temporary.open("wb") as output:  # noqa: S310
            shutil.copyfileobj(response, output, length=1024 * 1024)
            output.flush()
            os.fsync(output.fileno())
        _require_file(
            temporary,
            bytes_count=bytes_count,
            algorithm=algorithm,
            checksum=checksum,
        )
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    else:
        temporary.replace(destination)
        return True


def _download_source_file(source: SourceFile, destination: Path) -> bool:
    return _download(
        str(source.url),
        destination,
        bytes_count=source.bytes,
        algorithm="md5",
        checksum=source.md5,
        expected_host="zenodo.org",
    )


def acquire_metadata(root: Path = PROJECT_DIR) -> int:
    manifest = load_manifest(root)
    output = root / "data/metadata"
    installed = sum(
        _download_source_file(task.metadata, output / task.metadata.filename)
        for task in manifest.tasks
    )
    table = manifest.supplementary_table_s2
    installed += _download(
        str(table.url),
        output / table.filename,
        bytes_count=table.bytes,
        algorithm="sha256",
        checksum=table.sha256,
        expected_host="ars.els-cdn.com",
    )
    return installed


def acquire_artifacts(root: Path = PROJECT_DIR, max_bytes: int = 0) -> int:
    manifest = load_manifest(root)
    if manifest.expected.archive_bytes > max_bytes:
        raise SourceDataError(
            f"SegPath archives require {manifest.expected.archive_bytes} bytes, "
            f"limit is {max_bytes}"
        )
    output = root / "data/artifacts"
    return sum(
        _download_source_file(task.archive, output / task.archive.filename)
        for task in manifest.tasks
    )


def verify_metadata_contract(root: Path = PROJECT_DIR) -> dict[str, object]:
    manifest = load_manifest(root)
    return {
        "dataset_id": manifest.dataset_id,
        "license": manifest.license.spdx_id,
        "task_count": len(manifest.tasks),
        "record_count": manifest.expected.record_count,
        "artifact_reference_count": manifest.expected.artifact_count,
        "archive_bytes": manifest.expected.archive_bytes,
        "metadata_bytes": manifest.expected.metadata_bytes,
        "published_artifacts": manifest.annotation_provenance.published_artifacts,
        "unpublished_intermediate_artifacts": (
            manifest.annotation_provenance.unpublished_intermediate_artifacts
        ),
    }


def _shared_strings(source: ZipFile) -> list[str]:
    try:
        root = ElementTree.fromstring(source.read("xl/sharedStrings.xml"))
    except KeyError as error:
        raise SourceDataError("Table S2 lacks its shared string table") from error
    return [
        "".join(node.text or "" for node in item.iterfind(".//m:t", _XLSX_NAMESPACE))
        for item in root.findall("m:si", _XLSX_NAMESPACE)
    ]


def load_table_s2(path: Path) -> list[TableS2Row]:
    try:
        with ZipFile(path) as source:
            shared = _shared_strings(source)
            sheet = ElementTree.fromstring(source.read("xl/worksheets/sheet1.xml"))
    except (BadZipFile, KeyError, ElementTree.ParseError) as error:
        raise SourceDataError("Table S2 is not a readable publisher XLSX file") from error
    rows: list[TableS2Row] = []
    for xml_row in sheet.findall(".//m:sheetData/m:row", _XLSX_NAMESPACE)[2:]:
        values: dict[str, str] = {}
        for cell in xml_row.findall("m:c", _XLSX_NAMESPACE):
            reference = cell.get("r", "")
            raw_value = cell.findtext("m:v", default="", namespaces=_XLSX_NAMESPACE)
            if not reference or not raw_value:
                continue
            value = shared[int(raw_value)] if cell.get("t") == "s" else raw_value
            values[reference[0]] = value
        if not {"A", "B", "C"}.issubset(values):
            continue
        rows.append(
            TableS2Row(
                tma_number=int(values["A"]),
                tumour_type=values["B"],
                antibody_target=values["C"],
            )
        )
    if not rows:
        raise SourceDataError("Table S2 contains no histopathological specimen rows")
    return rows


def _tumour_type_indexes(
    rows: list[TableS2Row],
) -> tuple[dict[tuple[int, str], str], dict[int, set[str]]]:
    by_task_slide: dict[tuple[int, str], str] = {}
    by_slide: dict[int, set[str]] = defaultdict(set)
    for row in rows:
        key = (row.tma_number, row.antibody_target)
        existing = by_task_slide.setdefault(key, row.tumour_type)
        if existing != row.tumour_type:
            raise SourceDataError(f"Table S2 gives conflicting tumour types for {key}")
        by_slide[row.tma_number].add(row.tumour_type)
    return by_task_slide, by_slide


def _published_tumour_type(
    source_slide_id: str,
    task: SourceTask,
    by_task_slide: dict[tuple[int, str], str],
    by_slide: dict[int, set[str]],
) -> tuple[str, bool]:
    number = int(source_slide_id)
    direct = by_task_slide.get((number, task.table_s2_antibody_target))
    if direct is not None:
        return direct, False
    fallbacks = by_slide.get(number, set())
    if len(fallbacks) != 1:
        raise SourceDataError(
            f"Table S2 has no unambiguous tumour type for {task.task_id} slide {source_slide_id}"
        )
    return next(iter(fallbacks)), True


def _metadata_pattern(task: SourceTask) -> re.Pattern[str]:
    prefix = re.escape(task.task_id)
    return re.compile(
        rf"^(?P<task>{prefix})_(?P<slide>[0-9]+)_(?P<x>[0-9]+)_(?P<y>[0-9]+)_(?P<role>HE|mask)\.png$"
    )


def _load_metadata_pairs(
    path: Path, task: SourceTask
) -> dict[str, dict[Literal["he", "mask"], MetadataAsset]]:
    pairs: dict[str, dict[Literal["he", "mask"], MetadataAsset]] = {}
    pattern = _metadata_pattern(task)
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if reader.fieldnames != ["antibody", "filename", "train_val_test"]:
            raise SourceDataError(f"unexpected SegPath metadata fields in {path.name}")
        for row in reader:
            if row["antibody"] != task.antibody:
                raise SourceDataError(f"unexpected antibody in {path.name}: {row['antibody']}")
            member = PurePosixPath(row["filename"])
            if member.is_absolute() or ".." in member.parts or len(member.parts) != 2:
                raise SourceDataError(f"unsafe SegPath archive member: {row['filename']}")
            if member.parts[0] != task.task_id:
                raise SourceDataError(f"archive member belongs to another task: {row['filename']}")
            match = pattern.fullmatch(member.name)
            if match is None:
                raise SourceDataError(f"unexpected SegPath filename: {row['filename']}")
            source_role = row["train_val_test"]
            if source_role not in {"train", "val", "test"}:
                raise SourceDataError(f"unexpected SegPath source role: {source_role}")
            role: Literal["he", "mask"] = "he" if match.group("role") == "HE" else "mask"
            record_id = member.name.removesuffix("_HE.png").removesuffix("_mask.png")
            record_assets = pairs.setdefault(record_id, {})
            if role in record_assets:
                raise SourceDataError(f"duplicate {role} artifact for {record_id}")
            record_assets[role] = MetadataAsset(
                member_path=member.as_posix(),
                source_role=cast(SourceRole, source_role),
            )
    return pairs


def _artifact_reference(
    manifest: SourceManifest,
    task: SourceTask,
    record_id: str,
    asset: MetadataAsset,
    role: Literal["he", "mask"],
) -> ArtifactReference:
    source_role = "he_input" if role == "he" else "if_derived_binary_mask"
    return ArtifactReference(
        artifact_ref=(f"segpath://{manifest.dataset_id}/{task.task_id}/{record_id}/{source_role}"),
        archive_filename=task.archive.filename,
        member_path=asset.member_path,
        role=source_role,
    )


def _native_record(
    manifest: SourceManifest,
    task: SourceTask,
    record_id: str,
    assets: dict[Literal["he", "mask"], MetadataAsset],
    by_task_slide: dict[tuple[int, str], str],
    by_slide: dict[int, set[str]],
) -> tuple[NativeRecord, bool]:
    if set(assets) != {"he", "mask"}:
        raise SourceDataError(f"SegPath record lacks an H&E/mask pair: {record_id}")
    if assets["he"].source_role != assets["mask"].source_role:
        raise SourceDataError(f"SegPath pair has inconsistent source roles: {record_id}")
    match = _metadata_pattern(task).fullmatch(f"{record_id}_HE.png")
    if match is None:
        raise SourceDataError(f"cannot parse SegPath record identity: {record_id}")
    source_slide_id = match.group("slide")
    tumour_type, used_fallback = _published_tumour_type(
        source_slide_id, task, by_task_slide, by_slide
    )
    he_input = _artifact_reference(manifest, task, record_id, assets["he"], "he")
    mask = _artifact_reference(manifest, task, record_id, assets["mask"], "mask")
    annotation = AnnotationReference(
        artifact=mask,
        provenance_task_id=task.task_id,
        registered_to_artifact_ref=he_input.artifact_ref,
    )
    return (
        NativeRecord(
            dataset_id=manifest.dataset_id,
            record_id=record_id,
            source_task_id=task.task_id,
            antibody=task.antibody,
            paper_target=task.paper_target,
            source_slide_id=source_slide_id,
            source_slide_key=f"{task.task_id}:{source_slide_id}",
            published_tumour_type=tumour_type,
            wsi_x=int(match.group("x")),
            wsi_y=int(match.group("y")),
            width_pixels=manifest.image.width_pixels,
            height_pixels=manifest.image.height_pixels,
            micrometers_per_pixel=manifest.image.micrometers_per_pixel,
            source_role=assets["he"].source_role,
            he_input=he_input,
            annotation=annotation,
        ),
        used_fallback,
    )


def _require_task_metrics(
    task: SourceTask,
    record_count: int,
    slide_count: int,
    role_counts: dict[str, int],
) -> None:
    if record_count != task.expected.records:
        raise SourceDataError(f"{task.task_id} record count differs from its manifest")
    if slide_count != task.expected.slides:
        raise SourceDataError(f"{task.task_id} slide count differs from its manifest")
    if role_counts != task.expected.source_roles:
        raise SourceDataError(f"{task.task_id} source roles differ from its manifest")


def _require_record_total(total_records: int, manifest: SourceManifest) -> None:
    if total_records != manifest.expected.record_count:
        raise SourceDataError("SegPath record total differs from its manifest")


def index_metadata(root: Path = PROJECT_DIR) -> dict[str, object]:
    manifest = load_manifest(root)
    metadata_root = root / "data/metadata"
    rows = load_table_s2(metadata_root / manifest.supplementary_table_s2.filename)
    by_task_slide, by_slide = _tumour_type_indexes(rows)
    output_root = root / "outputs"
    output_root.mkdir(parents=True, exist_ok=True)
    output_path = output_root / "native-records.jsonl"
    temporary = output_path.with_name(f".{output_path.name}.part")
    task_metrics: dict[str, object] = {}
    all_slide_ids: set[str] = set()
    fallback_task_slides: dict[str, set[str]] = defaultdict(set)
    total_records = 0
    try:
        with temporary.open("w", encoding="utf-8") as output:
            for task in manifest.tasks:
                pairs = _load_metadata_pairs(metadata_root / task.metadata.filename, task)
                role_counts: Counter[str] = Counter()
                slide_ids: set[str] = set()
                for record_id in sorted(pairs):
                    record, used_fallback = _native_record(
                        manifest,
                        task,
                        record_id,
                        pairs[record_id],
                        by_task_slide,
                        by_slide,
                    )
                    output.write(json.dumps(record.model_dump(mode="json"), sort_keys=True) + "\n")
                    role_counts[record.source_role] += 1
                    slide_ids.add(record.source_slide_id)
                    all_slide_ids.add(record.source_slide_id)
                    if used_fallback:
                        fallback_task_slides[task.task_id].add(record.source_slide_id)
                _require_task_metrics(
                    task,
                    len(pairs),
                    len(slide_ids),
                    {role: role_counts[role] for role in ("train", "val", "test")},
                )
                task_metrics[task.task_id] = {
                    "antibody": task.antibody,
                    "paper_target": task.paper_target,
                    "records": len(pairs),
                    "slides": len(slide_ids),
                    "source_roles": {role: role_counts[role] for role in ("train", "val", "test")},
                }
                total_records += len(pairs)
        _require_record_total(total_records, manifest)
        temporary.replace(output_path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    metrics: dict[str, object] = {
        "dataset_id": manifest.dataset_id,
        "records": total_records,
        "artifact_references": total_records * 2,
        "source_slide_id_count": len(all_slide_ids),
        "tasks": task_metrics,
        "table_s2_task_fallbacks": {
            task_id: sorted(slides, key=int)
            for task_id, slides in sorted(fallback_task_slides.items())
        },
    }
    (output_root / "source-metrics.json").write_text(
        json.dumps(metrics, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return metrics
