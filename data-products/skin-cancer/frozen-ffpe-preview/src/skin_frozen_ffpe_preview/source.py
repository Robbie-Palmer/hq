from __future__ import annotations

import hashlib
import json
import os
import tempfile
from collections import Counter
from collections.abc import Mapping
from datetime import datetime
from pathlib import Path
from typing import Any

import openslide
import requests
from defusedxml import ElementTree
from PIL import Image

from skin_frozen_ffpe_preview.models import (
    NativeArtifact,
    NativeRecord,
    PreviewCase,
    SourceFile,
    SourceManifest,
)

PROJECT_DIR = Path(__file__).resolve().parents[2]
USER_AGENT = "skin-frozen-ffpe-preview/0.1 (+source-integrity-check)"


class SourceDataError(RuntimeError):
    pass


def load_manifest(root: Path = PROJECT_DIR) -> SourceManifest:
    return SourceManifest.model_validate_json((root / "manifest.json").read_text(encoding="utf-8"))


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def publish_contracts(root: Path = PROJECT_DIR) -> None:
    _write_json(root / "contracts/source-manifest.schema.json", SourceManifest.model_json_schema())
    _write_json(root / "contracts/native-record.schema.json", NativeRecord.model_json_schema())


def _artifact_url(manifest: SourceManifest, file: SourceFile) -> str:
    return f"{str(manifest.source.api_url).rstrip('/')}/files/{file.name}/content"


def _artifact(file: SourceFile, manifest: SourceManifest) -> NativeArtifact:
    return NativeArtifact(
        artifact_ref=f"skin-frozen-ffpe-preview:{file.name}",
        filename=file.name,
        role=file.role,
        bytes=file.bytes,
        md5=file.md5,
        retrieval_url=_artifact_url(manifest, file),
    )


def _record(manifest: SourceManifest, case: PreviewCase, preparation: str) -> NativeRecord:
    files = [
        item
        for item in manifest.files
        if item.case_id == case.case_id and item.preparation == preparation
    ]
    return NativeRecord.model_validate(
        {
            "dataset_id": manifest.dataset_id,
            "record_ref": f"skin-frozen-ffpe-preview:{case.case_id}:{preparation}",
            "case_id": case.case_id,
            "publisher_folder": case.publisher_folder,
            "subtype": case.subtype,
            "specimen_context": manifest.preview.context,
            "preparation": preparation,
            "source_role": manifest.preview.publisher_role,
            "publisher_partition": None,
            "paired_case_ref": f"skin-frozen-ffpe-preview:{case.case_id}",
            "pairing_basis": "publisher-declared same case",
            "spatial_registration": False,
            "identical_cutting_plane": False,
            "availability": "metadata_only",
            "usable_wsi": False,
            "pixel_payload_status": "missing companion MRXS pixel directory",
            "annotation_status": "empty annotations element",
            "artifacts": [_artifact(item, manifest) for item in files],
        }
    )


def publish_index(root: Path = PROJECT_DIR) -> dict[str, object]:
    manifest = load_manifest(root)
    records = [
        _record(manifest, case, preparation)
        for case in manifest.preview.cases
        for preparation in ("frozen", "ffpe")
    ]
    output_root = root / "outputs"
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "native-index.jsonl").write_text(
        "".join(
            json.dumps(record.model_dump(mode="json"), sort_keys=True) + "\n" for record in records
        ),
        encoding="utf-8",
    )
    _write_json(output_root / "source-contract.json", manifest.model_dump(mode="json"))
    preparation_counts = Counter(record.preparation for record in records)
    metrics: dict[str, object] = {
        "dataset_id": manifest.dataset_id,
        "source_file_count": len(manifest.files),
        "source_total_bytes": sum(item.bytes for item in manifest.files),
        "preview_case_count": len(manifest.preview.cases),
        "metadata_record_count": len(records),
        "records_by_preparation": dict(sorted(preparation_counts.items())),
        "usable_wsi_count": sum(record.usable_wsi for record in records),
        "records_missing_companion_pixel_directory": sum(
            record.pixel_payload_status == "missing companion MRXS pixel directory"
            for record in records
        ),
        "full_study_paired_slide_count": manifest.paper_context.paired_frozen_ffpe_slide_count,
        "preview_contains_full_cohort": manifest.paper_context.preview_contains_full_cohort,
    }
    _write_json(output_root / "source-metrics.json", metrics)
    return metrics


def _json_response(url: str) -> dict[str, Any]:
    response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=(10, 60))
    response.raise_for_status()
    value = response.json()
    if not isinstance(value, dict):
        raise SourceDataError("Zenodo returned a non-object record")
    return value


def _remote_file_projection(item: Mapping[str, Any]) -> dict[str, object]:
    checksum = str(item.get("checksum", ""))
    return {
        "name": item.get("key"),
        "bytes": item.get("size"),
        "md5": checksum.removeprefix("md5:"),
    }


def _manifest_file_projection(item: SourceFile) -> dict[str, object]:
    return {"name": item.name, "bytes": item.bytes, "md5": item.md5}


def verify_live_metadata(
    root: Path = PROJECT_DIR, payload: Mapping[str, Any] | None = None
) -> dict[str, object]:
    manifest = load_manifest(root)
    record = payload if payload is not None else _json_response(str(manifest.source.api_url))
    metadata = record.get("metadata")
    if not isinstance(metadata, dict):
        raise SourceDataError("Zenodo record has no metadata object")
    if record.get("id") != manifest.source.record_id or record.get("doi") != manifest.source.doi:
        raise SourceDataError("Zenodo record identity differs from the pinned source")
    if metadata.get("title") != manifest.title or metadata.get("publication_date") != str(
        manifest.source.published_at
    ):
        raise SourceDataError("Zenodo title or publication date differs from the pinned source")
    license_metadata = metadata.get("license")
    if not isinstance(license_metadata, dict) or license_metadata.get("id") != "cc-by-4.0":
        raise SourceDataError("Zenodo preview rights differ from CC BY 4.0")
    updated = record.get("updated")
    if (
        not isinstance(updated, str)
        or datetime.fromisoformat(updated) != manifest.source.updated_at
    ):
        raise SourceDataError("Zenodo update timestamp differs from the pinned source")
    remote_files_value = record.get("files")
    if not isinstance(remote_files_value, list):
        raise SourceDataError("Zenodo record has no file list")
    remote_files = sorted(
        (_remote_file_projection(item) for item in remote_files_value if isinstance(item, dict)),
        key=lambda item: str(item["name"]),
    )
    expected_files = sorted(
        (_manifest_file_projection(item) for item in manifest.files),
        key=lambda item: str(item["name"]),
    )
    if remote_files != expected_files:
        raise SourceDataError(
            "Zenodo file identities, sizes, or checksums differ from the manifest"
        )
    return {
        "record_id": manifest.source.record_id,
        "doi": manifest.source.doi,
        "file_count": len(remote_files),
        "total_bytes": sum(item.bytes for item in manifest.files),
        "license_spdx_id": manifest.rights.preview_dataset.spdx_id,
        "metadata_matches": True,
        "payloads_downloaded": False,
    }


def _md5(path: Path) -> str:
    digest = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_local_file(path: Path, file: SourceFile) -> None:
    if not path.is_file() or path.is_symlink():
        raise SourceDataError(f"missing regular source file: {file.name}")
    if path.stat().st_size != file.bytes:
        raise SourceDataError(f"byte count differs for {file.name}")
    if _md5(path) != file.md5:
        raise SourceDataError(f"MD5 differs for {file.name}")


def _download(file: SourceFile, manifest: SourceManifest, destination: Path) -> None:
    with requests.get(
        _artifact_url(manifest, file),
        headers={"User-Agent": USER_AGENT},
        stream=True,
        timeout=(10, 60),
    ) as response:
        response.raise_for_status()
        with destination.open("wb") as output:
            for chunk in response.iter_content(chunk_size=64 * 1024):
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
    verify_local_file(destination, file)


def acquire_file(filename: str, root: Path = PROJECT_DIR) -> Path:
    manifest = load_manifest(root)
    file = next((item for item in manifest.files if item.name == filename), None)
    if file is None:
        raise SourceDataError(f"unknown source filename: {filename}")
    destination = root / "data/raw" / file.name
    if destination.is_file():
        verify_local_file(destination, file)
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(f"{destination.suffix}.part")
    temporary.unlink(missing_ok=True)
    try:
        _download(file, manifest, temporary)
        temporary.replace(destination)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return destination


def _verify_xml(path: Path, role: str) -> None:
    root = ElementTree.parse(path).getroot()
    if role == "annotation_xml":
        annotations = [
            element for element in root.iter() if element.tag.rsplit("}", 1)[-1] == "annotations"
        ]
        if len(annotations) != 1 or list(annotations[0]):
            raise SourceDataError(f"{path.name}: annotation missingness differs from the manifest")


def _probe_mrxs_named_jpeg(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        if image.format != "JPEG":
            raise SourceDataError(f"{path.name}: payload is no longer a JFIF JPEG")
        dimensions = image.size
        image.verify()
    try:
        slide = openslide.OpenSlide(path)
    except openslide.OpenSlideUnsupportedFormatError:
        return dimensions
    slide.close()
    raise SourceDataError(f"{path.name}: now opens as a WSI; update the metadata-only contract")


def verify_live_payloads(root: Path = PROJECT_DIR) -> dict[str, object]:
    manifest = load_manifest(root)
    verify_live_metadata(root)
    jpeg_dimensions: dict[str, list[int]] = {}
    with tempfile.TemporaryDirectory(prefix="skin-frozen-ffpe-preview-") as temporary_name:
        temporary = Path(temporary_name)
        for file in manifest.files:
            destination = temporary / file.name
            _download(file, manifest, destination)
            if file.role == "mrxs_named_slide_file":
                width, height = _probe_mrxs_named_jpeg(destination)
                jpeg_dimensions[file.name] = [width, height]
            else:
                _verify_xml(destination, file.role)
        if any(path.is_dir() for path in temporary.iterdir()):
            raise SourceDataError(
                "unexpected companion directory appeared in the Zenodo payload set"
            )
    return {
        "file_count": len(manifest.files),
        "total_bytes": sum(item.bytes for item in manifest.files),
        "checksums_matched": len(manifest.files),
        "xml_payloads_parsed": sum(item.name.endswith(".xml") for item in manifest.files),
        "mrxs_named_jpeg_payloads": len(jpeg_dimensions),
        "openslide_unsupported_payloads": len(jpeg_dimensions),
        "companion_pixel_directories_present": False,
        "usable_wsi_count": 0,
        "availability": "metadata_only",
        "jpeg_dimensions": dict(sorted(jpeg_dimensions.items())),
        "temporary_payloads_removed": True,
    }
