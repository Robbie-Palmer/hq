from __future__ import annotations

import csv
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

from data_artifacts.files import load_model, md5_file, sha256_file, write_json

from .contracts import (
    AcquisitionEvidence,
    ArchiveEvidence,
    CohortEvidence,
    DatasetManifest,
    SourceArchive,
    SplitItem,
)


def load_dataset_manifest(path: Path) -> DatasetManifest:
    return load_model(path, DatasetManifest)


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
            raise ValueError("source archive redirect must use HTTPS")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _download(archive: SourceArchive, destination: Path) -> None:
    url = str(archive.url)
    if not url.startswith("https://"):
        raise ValueError("source archive URL must use HTTPS")
    request = urllib.request.Request(  # noqa: S310
        url, headers={"User-Agent": "Pathologize/1.0"}
    )
    opener = urllib.request.build_opener(_HttpsOnlyRedirectHandler())
    with (
        opener.open(request, timeout=60) as response,
        destination.open("wb") as target,
    ):
        shutil.copyfileobj(response, target, length=1024 * 1024)
    if destination.stat().st_size != archive.bytes:
        raise ValueError(f"downloaded byte count differs for {archive.name}")
    if md5_file(destination) != archive.md5 or sha256_file(destination) != archive.sha256:
        raise ValueError(f"downloaded digest differs for {archive.name}")


def _safe_members(source: zipfile.ZipFile, archive: SourceArchive) -> list[zipfile.ZipInfo]:
    members: list[zipfile.ZipInfo] = []
    for member in source.infolist():
        path = PurePosixPath(member.filename)
        if member.is_dir():
            continue
        if path.is_absolute() or ".." in path.parts:
            raise ValueError(f"unsafe archive member: {member.filename}")
        if member.filename.startswith(archive.member_prefix) and member.filename.endswith(
            archive.member_suffix
        ):
            members.append(member)
    if not members:
        raise ValueError(f"archive {archive.name} contains no expected members")
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


def acquire_dataset(manifest_path: Path, output: Path) -> AcquisitionEvidence:
    manifest = load_dataset_manifest(manifest_path)
    if output.exists():
        raise FileExistsError(f"acquisition output already exists: {output}")
    output.mkdir(parents=True)
    complete = False
    try:
        evidence: list[ArchiveEvidence] = []
        with TemporaryDirectory(prefix="pathologize-nucls-") as temporary:
            temporary_root = Path(temporary)
            for archive in manifest.archives:
                archive_path = temporary_root / f"{archive.name}.zip"
                _download(archive, archive_path)
                extracted = _extract(archive_path, archive, output)
                evidence.append(
                    ArchiveEvidence(
                        name=archive.name,
                        url=str(archive.url),
                        bytes=archive.bytes,
                        md5=archive.md5,
                        sha256=archive.sha256,
                        extracted_files=extracted,
                    )
                )
        result = AcquisitionEvidence(
            schema_version="1.0.0", dataset_id=manifest.dataset_id, archives=evidence
        )
        write_json(output / "acquisition.json", result)
        complete = True
    finally:
        if not complete:
            shutil.rmtree(output, ignore_errors=True)
    return result


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

    @property
    def center(self) -> tuple[float, float]:
        return (self.xmin + self.xmax) / 2, (self.ymin + self.ymax) / 2


def _coordinates(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in value.split(",") if part)


def load_annotations(path: Path) -> list[Annotation]:
    annotations: list[Annotation] = []
    with path.open(encoding="utf-8", newline="") as source:
        for row in csv.DictReader(source):
            annotation_type = row["type"]
            if annotation_type not in {"point", "polyline", "rectangle"}:
                raise ValueError(f"unknown NuCLS annotation type: {annotation_type}")
            coordinates_x = _coordinates(row["coords_x"])
            coordinates_y = _coordinates(row["coords_y"])
            if len(coordinates_x) != len(coordinates_y):
                raise ValueError(f"polygon coordinate length differs in {path}")
            annotations.append(
                Annotation(
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


def _split_rows(path: Path) -> dict[str, str]:
    with path.open(encoding="utf-8", newline="") as source:
        return {row["slide_name"]: row["hospital"] for row in csv.DictReader(source)}


def _patient_id(slide_id: str) -> str:
    parts = slide_id.split("-")
    if len(parts) < 3:
        raise ValueError(f"invalid TCGA slide barcode: {slide_id}")
    return "-".join(parts[:3])


def _item_id(path: Path) -> str:
    return path.stem


def _slide_id(item_id: str) -> str:
    slide_id, separator, _ = item_id.partition("_id-")
    if not separator:
        raise ValueError(f"item name lacks a NuCLS slide barcode: {item_id}")
    return slide_id


def _intersection(values: dict[str, set[str]], left: str, right: str) -> list[str]:
    return sorted(values[left].intersection(values[right]))


def build_cohort(data_root: Path, test_fold: int, validation_fold: int) -> CohortEvidence:
    split_root = data_root / "splits"
    test_sites = _split_rows(split_root / f"fold_{test_fold}_test.csv")
    test_train_sites = _split_rows(split_root / f"fold_{test_fold}_train.csv")
    validation_sites = _split_rows(split_root / f"fold_{validation_fold}_test.csv")
    validation_slides = set(validation_sites)
    if not validation_slides.issubset(test_train_sites):
        raise ValueError("validation fold is not a subset of the test fold's training cohort")
    if set(test_sites).intersection(test_train_sites):
        raise ValueError("test fold overlaps the test fold's training cohort")
    train_sites = {
        slide: site for slide, site in test_train_sites.items() if slide not in validation_slides
    }
    slide_split: dict[str, Literal["train", "validation", "test"]] = {
        **dict.fromkeys(train_sites, "train"),
        **dict.fromkeys(validation_sites, "validation"),
        **dict.fromkeys(test_sites, "test"),
    }
    site_by_slide = {**train_sites, **validation_sites, **test_sites}
    items: list[SplitItem] = []
    for image_path in sorted((data_root / "rgb").glob("*.png")):
        item_id = _item_id(image_path)
        slide_id = _slide_id(item_id)
        annotation_path = data_root / "annotations" / f"{item_id}.csv"
        if slide_id not in slide_split:
            raise ValueError(f"slide missing from frozen folds: {slide_id}")
        if not annotation_path.is_file():
            raise ValueError(f"annotation missing for {item_id}")
        items.append(
            SplitItem(
                item_id=item_id,
                slide_id=slide_id,
                patient_id=_patient_id(slide_id),
                site_id=site_by_slide[slide_id],
                split=slide_split[slide_id],
                image_path=image_path.relative_to(data_root).as_posix(),
                annotation_path=annotation_path.relative_to(data_root).as_posix(),
            )
        )
    if not items:
        raise ValueError("NuCLS cohort contains no items")
    split_names = ("train", "validation", "test")
    patient_sets = {
        split: {item.patient_id for item in items if item.split == split} for split in split_names
    }
    slide_sets = {
        split: {item.slide_id for item in items if item.split == split} for split in split_names
    }
    site_sets = {
        split: {item.site_id for item in items if item.split == split} for split in split_names
    }
    patient_intersections = {
        "train_validation": _intersection(patient_sets, "train", "validation"),
        "train_test": _intersection(patient_sets, "train", "test"),
        "validation_test": _intersection(patient_sets, "validation", "test"),
    }
    slide_intersections = {
        "train_validation": _intersection(slide_sets, "train", "validation"),
        "train_test": _intersection(slide_sets, "train", "test"),
        "validation_test": _intersection(slide_sets, "validation", "test"),
    }
    site_intersections = {
        "train_validation": _intersection(site_sets, "train", "validation"),
        "train_test": _intersection(site_sets, "train", "test"),
        "validation_test": _intersection(site_sets, "validation", "test"),
    }
    if any(patient_intersections.values()) or any(slide_intersections.values()):
        raise ValueError("frozen NuCLS cohort leaks patients or slides across splits")
    if site_intersections["train_test"]:
        raise ValueError("official NuCLS test fold is not site-held-out from training")
    item_counts = Counter(item.split for item in items)
    site_counts = Counter(item.site_id for item in items if item.split == "test")
    return CohortEvidence(
        schema_version="1.0.0",
        leakage_unit="patient_id",
        secondary_leakage_unit="slide_id",
        source_statement=(
            "NuCLS reports one TCGA slide per patient; the TCGA patient barcode is derived "
            "from the first three slide-barcode fields."
        ),
        items=items,
        item_counts={split: item_counts[split] for split in split_names},
        patient_counts={split: len(patient_sets[split]) for split in split_names},
        slide_counts={split: len(slide_sets[split]) for split in split_names},
        site_counts=dict(sorted(site_counts.items())),
        patient_intersections=patient_intersections,
        slide_intersections=slide_intersections,
        site_intersections=site_intersections,
        held_out_test_sites=sorted(site_counts),
    )


def load_cohort(path: Path) -> CohortEvidence:
    return load_model(path, CohortEvidence)
