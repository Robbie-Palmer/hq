from __future__ import annotations

import csv
import hashlib
import json
import shutil
import urllib.request
import zipfile
from collections import Counter
from dataclasses import dataclass
from http.client import HTTPMessage
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory
from typing import IO, Literal, override
from urllib.parse import urlsplit

from nucls_source_data.models import (
    AcquisitionEvidence,
    ArchiveEvidence,
    NativeRecord,
    SourceArchive,
    SourceManifest,
)

PROJECT_DIR = Path(__file__).resolve().parents[2]


class SourceDataError(RuntimeError):
    pass


@dataclass(frozen=True)
class Annotation:
    class_name: str
    annotation_type: Literal["point", "polyline", "rectangle"]
    xmin: int
    ymin: int
    xmax: int
    ymax: int
    coordinates_x: tuple[int, ...]
    coordinates_y: tuple[int, ...]
    raw_classification: str = ""
    main_classification: str = ""

    @property
    def center(self) -> tuple[float, float]:
        return (self.xmin + self.xmax) / 2, (self.ymin + self.ymax) / 2


def load_manifest(root: Path = PROJECT_DIR) -> SourceManifest:
    return SourceManifest.model_validate_json((root / "manifest.json").read_text(encoding="utf-8"))


def _digest(path: Path, algorithm: str) -> str:
    digest = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class _HttpsOnlyRedirectHandler(urllib.request.HTTPRedirectHandler):
    @override
    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: IO[bytes],
        code: int,
        msg: str,
        headers: HTTPMessage,
        newurl: str,
    ) -> urllib.request.Request | None:
        if urlsplit(newurl).scheme.lower() != "https":
            raise SourceDataError("source archive redirect must use HTTPS")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _download(archive: SourceArchive, destination: Path) -> None:
    request = urllib.request.Request(  # noqa: S310 - manifest constrains the URL to HTTPS.
        str(archive.url), headers={"User-Agent": "nucls-source-data/0.1"}
    )
    opener = urllib.request.build_opener(_HttpsOnlyRedirectHandler())
    with opener.open(request, timeout=60) as response, destination.open("wb") as target:
        shutil.copyfileobj(response, target, length=1024 * 1024)
    if destination.stat().st_size != archive.bytes:
        raise SourceDataError(f"downloaded byte count differs for {archive.name}")
    if _digest(destination, "md5") != archive.md5:
        raise SourceDataError(f"downloaded MD5 differs for {archive.name}")
    if _digest(destination, "sha256") != archive.sha256:
        raise SourceDataError(f"downloaded SHA-256 differs for {archive.name}")


def _safe_members(source: zipfile.ZipFile, archive: SourceArchive) -> list[zipfile.ZipInfo]:
    members: list[zipfile.ZipInfo] = []
    for member in source.infolist():
        path = PurePosixPath(member.filename)
        if member.is_dir():
            continue
        if path.is_absolute() or ".." in path.parts:
            raise SourceDataError(f"unsafe archive member: {member.filename}")
        if member.filename.startswith(archive.member_prefix) and member.filename.endswith(
            archive.member_suffix
        ):
            members.append(member)
    if not members:
        raise SourceDataError(f"archive {archive.name} contains no expected members")
    return members


def _extract(source_path: Path, archive: SourceArchive, output: Path) -> int:
    with zipfile.ZipFile(source_path) as source:
        members = _safe_members(source, archive)
        for member in members:
            relative = PurePosixPath(member.filename).relative_to(archive.member_prefix)
            destination = output / archive.name / Path(*relative.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            with source.open(member) as member_source, destination.open("wb") as target:
                shutil.copyfileobj(member_source, target)
    return len(members)


def acquire_dataset(root: Path = PROJECT_DIR) -> AcquisitionEvidence:
    manifest = load_manifest(root)
    output = root / "data/native"
    if output.exists():
        evidence_path = output / "acquisition.json"
        if not evidence_path.is_file():
            raise SourceDataError(f"incomplete acquisition output: {output}")
        return AcquisitionEvidence.model_validate_json(evidence_path.read_text(encoding="utf-8"))
    output.mkdir(parents=True)
    complete = False
    try:
        evidence: list[ArchiveEvidence] = []
        with TemporaryDirectory(prefix="nucls-source-") as temporary:
            temporary_root = Path(temporary)
            for archive in manifest.archives:
                archive_path = temporary_root / f"{archive.name}.zip"
                _download(archive, archive_path)
                evidence.append(
                    ArchiveEvidence(
                        name=archive.name,
                        url=str(archive.url),
                        bytes=archive.bytes,
                        md5=archive.md5,
                        sha256=archive.sha256,
                        extracted_files=_extract(archive_path, archive, output),
                    )
                )
        result = AcquisitionEvidence(
            schema_version="1.0.0", dataset_id=manifest.dataset_id, archives=evidence
        )
        (output / "acquisition.json").write_text(
            result.model_dump_json(indent=2) + "\n", encoding="utf-8"
        )
        complete = True
        return result
    finally:
        if not complete:
            shutil.rmtree(output, ignore_errors=True)


def _coordinates(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in value.split(",") if part)


def load_annotations(path: Path) -> list[Annotation]:
    annotations: list[Annotation] = []
    with path.open(encoding="utf-8", newline="") as source:
        for row in csv.DictReader(source):
            annotation_type = row["type"]
            if annotation_type not in {"point", "polyline", "rectangle"}:
                raise SourceDataError(f"unknown NuCLS annotation type: {annotation_type}")
            coordinates_x = _coordinates(row["coords_x"])
            coordinates_y = _coordinates(row["coords_y"])
            if len(coordinates_x) != len(coordinates_y):
                raise SourceDataError(f"polygon coordinate length differs in {path}")
            annotations.append(
                Annotation(
                    raw_classification=row["raw_classification"],
                    main_classification=row["main_classification"],
                    class_name=row["super_classification"],
                    annotation_type=annotation_type,
                    xmin=int(row["xmin"]),
                    ymin=int(row["ymin"]),
                    xmax=int(row["xmax"]),
                    ymax=int(row["ymax"]),
                    coordinates_x=coordinates_x,
                    coordinates_y=coordinates_y,
                )
            )
    return annotations


def _split_rows(path: Path) -> dict[str, str | None]:
    with path.open(encoding="utf-8", newline="") as source:
        return {row["slide_name"]: row.get("hospital") for row in csv.DictReader(source)}


def _slide_id(item_id: str) -> str:
    slide_id, separator, _ = item_id.partition("_id-")
    if not separator:
        raise SourceDataError(f"item name lacks a NuCLS slide barcode: {item_id}")
    return slide_id


def _patient_id(slide_id: str) -> str:
    parts = slide_id.split("-")
    if len(parts) < 3:
        raise SourceDataError(f"invalid TCGA slide barcode: {slide_id}")
    return "-".join(parts[:3])


def _source_roles(
    split_root: Path,
) -> tuple[dict[str, dict[str, Literal["train", "test"]]], dict[str, str]]:
    roles: dict[str, dict[str, Literal["train", "test"]]] = {}
    sites: dict[str, str] = {}
    for path in sorted(split_root.glob("fold_*_*.csv")):
        parts = path.stem.split("_")
        fold, role = parts[1], parts[2]
        if role not in {"train", "test"}:
            raise SourceDataError(f"unknown source role in {path.name}: {role}")
        for slide, site in _split_rows(path).items():
            roles.setdefault(slide, {})[fold] = role
            if site is None:
                continue
            existing = sites.setdefault(slide, site)
            if existing != site:
                raise SourceDataError(f"source site differs across folds for {slide}")
    return roles, sites


def index_dataset(root: Path = PROJECT_DIR) -> dict[str, object]:
    manifest = load_manifest(root)
    data_root = root / "data/native"
    roles, sites = _source_roles(data_root / "splits")
    records: list[NativeRecord] = []
    ontology_counts: dict[str, Counter[str]] = {
        "raw_classification": Counter(),
        "main_classification": Counter(),
        "super_classification": Counter(),
    }
    annotation_type_counts: Counter[str] = Counter()
    for image_path in sorted((data_root / "rgb").glob("*.png")):
        item_id = image_path.stem
        slide_id = _slide_id(item_id)
        annotation_path = data_root / "annotations" / f"{item_id}.csv"
        if slide_id not in roles or not annotation_path.is_file():
            raise SourceDataError(f"missing native metadata for {item_id}")
        annotations = load_annotations(annotation_path)
        labels_by_field = {
            "raw_classification": sorted(
                {annotation.raw_classification for annotation in annotations}
            ),
            "main_classification": sorted(
                {annotation.main_classification for annotation in annotations}
            ),
            "super_classification": sorted({annotation.class_name for annotation in annotations}),
        }
        ontology_counts["raw_classification"].update(
            annotation.raw_classification for annotation in annotations
        )
        ontology_counts["main_classification"].update(
            annotation.main_classification for annotation in annotations
        )
        ontology_counts["super_classification"].update(
            annotation.class_name for annotation in annotations
        )
        annotation_type_counts.update(annotation.annotation_type for annotation in annotations)
        records.append(
            NativeRecord(
                dataset_id=manifest.dataset_id,
                item_id=item_id,
                slide_id=slide_id,
                patient_id=_patient_id(slide_id),
                site_id=sites[slide_id],
                image_path=image_path.relative_to(root).as_posix(),
                annotation_path=annotation_path.relative_to(root).as_posix(),
                source_roles=roles[slide_id],
                source_labels_present=labels_by_field["super_classification"],
                source_ontology_labels_present=labels_by_field,
                annotation_count=len(annotations),
            )
        )
    if not records:
        raise SourceDataError("NuCLS source contains no image records")
    known_labels = {*manifest.classification_labels, *manifest.unmappable_categories}
    if set(ontology_counts["super_classification"]) != known_labels:
        raise SourceDataError("observed native labels differ from the source manifest")
    output_root = root / "outputs"
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "native-index.jsonl").write_text(
        "".join(
            json.dumps(record.model_dump(mode="json"), sort_keys=True) + "\n" for record in records
        ),
        encoding="utf-8",
    )
    metrics: dict[str, object] = {
        "dataset_id": manifest.dataset_id,
        "record_count": len(records),
        "slide_count": len({record.slide_id for record in records}),
        "patient_count": len({record.patient_id for record in records}),
        "site_count": len({record.site_id for record in records}),
        "official_fold_ids": sorted({fold for record in records for fold in record.source_roles}),
        "native_annotation_counts": dict(sorted(ontology_counts["super_classification"].items())),
        "native_ontology_counts": {
            field: dict(sorted(counts.items())) for field, counts in ontology_counts.items()
        },
        "annotation_type_counts": dict(sorted(annotation_type_counts.items())),
        "empty_annotation_record_count": sum(record.annotation_count == 0 for record in records),
    }
    (output_root / "source-metrics.json").write_text(
        json.dumps(metrics, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return metrics
