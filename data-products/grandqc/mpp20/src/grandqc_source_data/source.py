from __future__ import annotations

import hashlib
import json
import os
import shutil
import tarfile
from collections import Counter
from contextlib import closing
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image

from grandqc_source_data.models import NativePatchRecord, SourceManifest

PROJECT_DIR = Path(__file__).resolve().parents[2]


class SourceDataError(RuntimeError):
    pass


def load_manifest(root: Path = PROJECT_DIR) -> SourceManifest:
    return SourceManifest.model_validate_json((root / "manifest.json").read_text(encoding="utf-8"))


def _digest(path: Path, algorithm: str) -> str:
    digest = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_archive(path: Path, manifest: SourceManifest) -> None:
    if not path.is_file() or path.is_symlink():
        raise SourceDataError(f"missing regular archive: {path}")
    if path.stat().st_size != manifest.archive.bytes:
        raise SourceDataError(f"archive byte count differs: {path}")
    if _digest(path, "md5") != manifest.archive.md5:
        raise SourceDataError(f"archive MD5 differs: {path}")
    if _digest(path, "sha256") != manifest.archive.sha256:
        raise SourceDataError(f"archive SHA-256 differs: {path}")


def acquire_archive(root: Path = PROJECT_DIR) -> Path:
    manifest = load_manifest(root)
    destination = root / "data/raw" / manifest.archive.filename
    if destination.is_file():
        verify_archive(destination, manifest)
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".tar.part")
    temporary.unlink(missing_ok=True)
    request = Request(  # noqa: S310 - Pydantic constrains this source to the pinned HTTPS URL.
        str(manifest.archive.url),
        headers={"User-Agent": "grandqc-source-data/0.1 (+source-registry)"},
    )
    try:
        with closing(urlopen(request, timeout=60)) as response, temporary.open("wb") as output:  # noqa: S310
            shutil.copyfileobj(response, output, length=1024 * 1024)
            output.flush()
            os.fsync(output.fileno())
        verify_archive(temporary, manifest)
        temporary.replace(destination)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return destination


def _safe_members(archive: tarfile.TarFile) -> list[tarfile.TarInfo]:
    members = archive.getmembers()
    for member in members:
        path = Path(member.name)
        if path.is_absolute() or ".." in path.parts or member.issym() or member.islnk():
            raise SourceDataError(f"unsafe archive member: {member.name}")
        if not (member.isdir() or member.isfile()):
            raise SourceDataError(f"unsupported archive member: {member.name}")
    return members


def _require_extracted_root(root: Path) -> None:
    if not (root / "MPP20").is_dir():
        raise SourceDataError("archive did not contain the MPP20 root")


def extract_archive(archive_path: Path, destination: Path) -> Path:
    extracted = destination / "MPP20"
    completion_marker = destination / ".complete"
    if extracted.is_dir() and completion_marker.is_file():
        return extracted
    temporary = destination.with_name(f".{destination.name}.part")
    shutil.rmtree(temporary, ignore_errors=True)
    temporary.mkdir(parents=True)
    try:
        with tarfile.open(archive_path, "r") as archive:
            archive.extractall(temporary, members=_safe_members(archive), filter="data")
        _require_extracted_root(temporary)
        (temporary / ".complete").write_text("complete\n", encoding="utf-8")
        shutil.rmtree(destination, ignore_errors=True)
        temporary.replace(destination)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return extracted


def _sample_id(relative_stem: str) -> str:
    digest = hashlib.sha256(f"grandqc-test-mpp20-v1:{relative_stem}".encode()).hexdigest()
    return f"grandqc:{digest}"


def _mask_counts(path: Path, allowed_ids: set[int]) -> dict[int, int]:
    with Image.open(path) as image:
        colors = image.getcolors(maxcolors=256)
        if colors is None:
            raise SourceDataError(f"{path}: mask has more than 256 distinct values")
        if any(not isinstance(value, int) for _, value in colors):
            raise SourceDataError(f"{path}: mask pixels must contain integer class IDs")
        counts = Counter({value: count for count, value in colors if isinstance(value, int)})
    unknown = set(counts) - allowed_ids
    if unknown:
        raise SourceDataError(f"{path}: unknown native labels {sorted(unknown)}")
    return dict(sorted(counts.items()))


def _patch_record(
    image_path: Path,
    mask_path: Path,
    native_root: Path,
    project_root: Path,
    manifest: SourceManifest,
) -> NativePatchRecord:
    relative_image = image_path.relative_to(project_root).as_posix()
    relative_mask = mask_path.relative_to(project_root).as_posix()
    relative_stem = image_path.relative_to(native_root).with_suffix("").as_posix()
    parts = image_path.relative_to(native_root).parts
    if len(parts) < 4 or parts[2] != "ALL":
        raise SourceDataError(f"unexpected GrandQC path: {image_path}")
    organ, source_group_id = parts[:2]
    with Image.open(image_path) as image:
        width, height = image.size
    counts = _mask_counts(mask_path, {label.id for label in manifest.native_labels})
    names = {label.id: label.name for label in manifest.native_labels}
    return NativePatchRecord(
        sample_id=_sample_id(relative_stem),
        organ=organ,
        source_group_id=source_group_id,
        image_path=relative_image,
        mask_path=relative_mask,
        width=width,
        height=height,
        native_label_ids_present=list(counts),
        native_label_pixel_counts={names[label_id]: count for label_id, count in counts.items()},
    )


def _json_line(record: NativePatchRecord) -> str:
    return json.dumps(record.model_dump(mode="json"), sort_keys=True) + "\n"


def index_archive(root: Path = PROJECT_DIR) -> dict[str, object]:
    manifest = load_manifest(root)
    archive_path = root / "data/raw" / manifest.archive.filename
    verify_archive(archive_path, manifest)
    native_root = extract_archive(archive_path, root / "data/native/mpp20")
    image_paths = sorted(native_root.glob("*/*/ALL/*.jpg"))
    records: list[NativePatchRecord] = []
    for image_path in image_paths:
        mask_path = image_path.with_suffix(".png")
        if not mask_path.is_file():
            raise SourceDataError(f"missing paired mask: {mask_path}")
        records.append(_patch_record(image_path, mask_path, native_root, root, manifest))
    orphan_masks = {path.with_suffix("") for path in native_root.glob("*/*/ALL/*.png")} - {
        path.with_suffix("") for path in image_paths
    }
    if orphan_masks:
        raise SourceDataError(f"found {len(orphan_masks)} masks without paired images")
    if len(records) != manifest.expected.paired_patch_count:
        raise SourceDataError(
            f"expected {manifest.expected.paired_patch_count} patch pairs, found {len(records)}"
        )
    output_root = root / "outputs"
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "native-index.jsonl").write_text(
        "".join(_json_line(record) for record in records), encoding="utf-8"
    )
    groups = {record.source_group_id for record in records}
    organ_counts = Counter(record.organ for record in records)
    label_pixels: Counter[str] = Counter()
    for record in records:
        label_pixels.update(record.native_label_pixel_counts)
    metrics: dict[str, object] = {
        "dataset_id": manifest.dataset_id,
        "native_role": manifest.native_role,
        "declared_wsi_count": manifest.expected.declared_wsi_count,
        "nonempty_source_group_count": len(groups),
        "paired_patch_count": len(records),
        "patches_by_organ": dict(sorted(organ_counts.items())),
        "native_label_pixels": dict(sorted(label_pixels.items())),
    }
    (output_root / "source-metrics.json").write_text(
        json.dumps(metrics, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return metrics
