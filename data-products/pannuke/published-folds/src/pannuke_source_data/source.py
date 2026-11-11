from __future__ import annotations

import hashlib
import json
import os
import stat
import urllib.request
import zipfile
from collections import Counter
from http.client import HTTPMessage
from pathlib import Path, PurePosixPath
from typing import IO, Literal, Protocol, cast, override
from urllib.parse import urlsplit

import numpy as np

from pannuke_source_data.models import (
    NativeArrayReference,
    NativeRecord,
    PublisherArchiveMetadata,
    PublisherMetadataEvidence,
    SourceArchive,
    SourceManifest,
)

PROJECT_DIR = Path(__file__).resolve().parents[2]


class SourceDataError(RuntimeError):
    pass


class Response(Protocol):
    headers: HTTPMessage

    def __enter__(self) -> Response: ...

    def __exit__(self, *args: object) -> None: ...

    def read(self, size: int = -1) -> bytes: ...


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


def _header(headers: HTTPMessage, name: str) -> str:
    value = headers.get(name)
    if value is None:
        raise SourceDataError(f"publisher response lacks {name}")
    return value


def _metadata_from_headers(
    archive: SourceArchive, headers: HTTPMessage
) -> PublisherArchiveMetadata:
    try:
        byte_count = int(_header(headers, "Content-Length"))
    except ValueError as error:
        raise SourceDataError("publisher Content-Length is not an integer") from error
    etag = _header(headers, "ETag").strip('"')
    last_modified = _header(headers, "Last-Modified")
    content_type = _header(headers, "Content-Type")
    expected = {
        "Content-Length": (byte_count, archive.bytes),
        "ETag": (etag, archive.publisher_etag),
        "Last-Modified": (last_modified, archive.publisher_last_modified),
        "Content-Type": (content_type, archive.publisher_content_type),
    }
    for name, (actual, pinned) in expected.items():
        if actual != pinned:
            raise SourceDataError(f"publisher {name} differs for fold {archive.fold}")
    return PublisherArchiveMetadata(
        fold=archive.fold,
        url=str(archive.url),
        bytes=byte_count,
        etag=etag,
        last_modified=last_modified,
        content_type=content_type,
    )


def verify_publisher_metadata(
    root: Path = PROJECT_DIR, output: Path | None = None
) -> PublisherMetadataEvidence:
    manifest = load_manifest(root)
    opener = urllib.request.build_opener(_HttpsOnlyRedirectHandler())
    evidence: list[PublisherArchiveMetadata] = []
    for archive in manifest.archives:
        request = urllib.request.Request(  # noqa: S310 - manifest requires pinned HTTPS URLs.
            str(archive.url),
            method="HEAD",
            headers={"User-Agent": "pannuke-source-data/0.1 (+metadata-verification)"},
        )
        with cast(Response, opener.open(request, timeout=60)) as response:
            evidence.append(_metadata_from_headers(archive, response.headers))
    result = PublisherMetadataEvidence(dataset_id=manifest.dataset_id, archives=evidence)
    if output is not None:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(result.model_dump_json(indent=2) + "\n", encoding="utf-8")
    return result


def verify_archive(path: Path, archive: SourceArchive) -> None:
    if not path.is_file() or path.is_symlink():
        raise SourceDataError(f"missing regular archive: {path}")
    if path.stat().st_size != archive.bytes:
        raise SourceDataError(f"archive byte count differs: {path}")
    if _digest(path, "sha1") != archive.sha1:
        raise SourceDataError(f"archive SHA-1 differs: {path}")
    if _digest(path, "sha256") != archive.sha256:
        raise SourceDataError(f"archive SHA-256 differs: {path}")


def _copy_archive(response: Response, target: IO[bytes], archive: SourceArchive) -> None:
    copied = 0
    while chunk := response.read(min(1024 * 1024, archive.bytes - copied + 1)):
        copied += len(chunk)
        if copied > archive.bytes:
            raise SourceDataError(
                f"source archive exceeds pinned byte count for fold {archive.fold}"
            )
        target.write(chunk)


def _download(archive: SourceArchive, destination: Path) -> None:
    temporary = destination.with_suffix(".zip.part")
    temporary.unlink(missing_ok=True)
    request = urllib.request.Request(  # noqa: S310 - manifest requires pinned HTTPS URLs.
        str(archive.url), headers={"User-Agent": "pannuke-source-data/0.1 (+source-product)"}
    )
    opener = urllib.request.build_opener(_HttpsOnlyRedirectHandler())
    try:
        with (
            cast(Response, opener.open(request, timeout=60)) as response,
            temporary.open("wb") as target,
        ):
            _copy_archive(response, target, archive)
            target.flush()
            os.fsync(target.fileno())
        verify_archive(temporary, archive)
        temporary.replace(destination)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def acquire_dataset(root: Path = PROJECT_DIR) -> list[Path]:
    manifest = load_manifest(root)
    output = root / "data/raw"
    output.mkdir(parents=True, exist_ok=True)
    acquired: list[Path] = []
    for archive in manifest.archives:
        destination = output / archive.filename
        if destination.exists():
            verify_archive(destination, archive)
        else:
            _download(archive, destination)
        acquired.append(destination)
    evidence = {
        "schema_version": "1.0.0",
        "dataset_id": manifest.dataset_id,
        "archives": [
            {
                "fold": archive.fold,
                "filename": archive.filename,
                "bytes": archive.bytes,
                "sha1": archive.sha1,
                "sha256": archive.sha256,
            }
            for archive in manifest.archives
        ],
    }
    (output / "acquisition.json").write_text(
        json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return acquired


def _required_members(fold: int) -> tuple[str, str, str]:
    prefix = f"Fold {fold}"
    return (
        f"{prefix}/images/fold{fold}/images.npy",
        f"{prefix}/images/fold{fold}/types.npy",
        f"{prefix}/masks/fold{fold}/masks.npy",
    )


def _safe_archive(source: zipfile.ZipFile) -> None:
    for member in source.infolist():
        path = PurePosixPath(member.filename)
        mode = member.external_attr >> 16
        if path.is_absolute() or ".." in path.parts or stat.S_ISLNK(mode):
            raise SourceDataError(f"unsafe archive member: {member.filename}")


def _array_header(source: zipfile.ZipFile, member: str) -> tuple[tuple[int, ...], str, bool]:
    with source.open(member) as stream:
        version = np.lib.format.read_magic(stream)
        if version == (1, 0):
            shape, fortran_order, dtype = np.lib.format.read_array_header_1_0(stream)
        elif version == (2, 0):
            shape, fortran_order, dtype = np.lib.format.read_array_header_2_0(stream)
        else:
            raise SourceDataError(f"unsupported NumPy format {version} in {member}")
    return shape, dtype.name, fortran_order


def _publisher_roles(
    manifest: SourceManifest, fold: int
) -> dict[str, Literal["training", "validation", "testing"]]:
    roles: dict[str, Literal["training", "validation", "testing"]] = {}
    for item in manifest.publisher_role_arrangements:
        role: Literal["training", "validation", "testing"]
        if fold == item.training_fold:
            role = "training"
        elif fold == item.validation_fold:
            role = "validation"
        else:
            role = "testing"
        roles[f"arrangement_{item.arrangement}"] = role
    return roles


def _fold_records(
    root: Path, manifest: SourceManifest, archive: SourceArchive
) -> tuple[list[NativeRecord], Counter[str]]:
    archive_path = root / "data/raw" / archive.filename
    verify_archive(archive_path, archive)
    image_member, tissue_member, mask_member = _required_members(archive.fold)
    with zipfile.ZipFile(archive_path) as source:
        _safe_archive(source)
        missing = {image_member, tissue_member, mask_member} - set(source.namelist())
        if missing:
            raise SourceDataError(f"fold {archive.fold} lacks members: {sorted(missing)}")
        image_shape, image_dtype, image_fortran = _array_header(source, image_member)
        mask_shape, mask_dtype, mask_fortran = _array_header(source, mask_member)
        with source.open(tissue_member) as stream:
            tissues = np.load(stream, allow_pickle=False)
    contract = manifest.array_contract
    expected_images = (
        archive.record_count,
        contract.height,
        contract.width,
        contract.image_channels,
    )
    expected_masks = (
        archive.record_count,
        contract.height,
        contract.width,
        contract.mask_channels,
    )
    if image_shape != expected_images or mask_shape != expected_masks:
        raise SourceDataError(f"fold {archive.fold} array shape differs from the source contract")
    if image_dtype != contract.dtype or mask_dtype != contract.dtype:
        raise SourceDataError(f"fold {archive.fold} array dtype differs from the source contract")
    if image_fortran or mask_fortran:
        raise SourceDataError(f"fold {archive.fold} arrays must use source C order")
    if tissues.shape != (archive.record_count,) or tissues.dtype.kind != "U":
        raise SourceDataError(f"fold {archive.fold} tissue array differs from the source contract")
    tissue_values = [str(value) for value in tissues.tolist()]
    unknown = set(tissue_values) - set(manifest.tissue_identities)
    if unknown:
        raise SourceDataError(f"fold {archive.fold} contains unknown tissue identities: {unknown}")
    records = [
        NativeRecord(
            dataset_id=manifest.dataset_id,
            repository_record_id=f"pannuke:fold-{archive.fold}:{index:06d}",
            source_fold=archive.fold,
            source_index=index,
            tissue_identity=tissue,
            publisher_roles=_publisher_roles(manifest, archive.fold),
            image_artifact=NativeArrayReference(
                archive_filename=archive.filename,
                archive_sha256=archive.sha256,
                member=image_member,
                array_index=index,
                element_shape=(contract.height, contract.width, contract.image_channels),
                dtype=contract.dtype,
            ),
            instance_mask_annotation=NativeArrayReference(
                archive_filename=archive.filename,
                archive_sha256=archive.sha256,
                member=mask_member,
                array_index=index,
                element_shape=(contract.height, contract.width, contract.mask_channels),
                dtype=contract.dtype,
            ),
        )
        for index, tissue in enumerate(tissue_values)
    ]
    return records, Counter(tissue_values)


def index_dataset(root: Path = PROJECT_DIR) -> dict[str, object]:
    manifest = load_manifest(root)
    records: list[NativeRecord] = []
    tissues_by_fold: dict[str, dict[str, int]] = {}
    for archive in manifest.archives:
        fold_records, tissue_counts = _fold_records(root, manifest, archive)
        records.extend(fold_records)
        tissues_by_fold[str(archive.fold)] = dict(sorted(tissue_counts.items()))
    observed_tissues = {record.tissue_identity for record in records}
    if observed_tissues != set(manifest.tissue_identities):
        raise SourceDataError("observed tissues differ from the source manifest")
    expected_total = sum(archive.record_count for archive in manifest.archives)
    if len(records) != expected_total:
        raise SourceDataError("native record count differs from the source manifest")
    output = root / "outputs"
    output.mkdir(parents=True, exist_ok=True)
    (output / "native-index.jsonl").write_text(
        "".join(
            json.dumps(record.model_dump(mode="json"), sort_keys=True) + "\n" for record in records
        ),
        encoding="utf-8",
    )
    metrics: dict[str, object] = {
        "dataset_id": manifest.dataset_id,
        "record_count": len(records),
        "records_by_fold": {
            str(archive.fold): archive.record_count for archive in manifest.archives
        },
        "tissue_record_counts_by_fold": tissues_by_fold,
        "tissue_identity_count": len(observed_tissues),
        "source_archive_count": len(manifest.archives),
        "source_image_shape": [
            manifest.array_contract.height,
            manifest.array_contract.width,
            manifest.array_contract.image_channels,
        ],
        "source_instance_mask_shape": [
            manifest.array_contract.height,
            manifest.array_contract.width,
            manifest.array_contract.mask_channels,
        ],
        "source_array_dtype": manifest.array_contract.dtype,
    }
    (output / "source-metrics.json").write_text(
        json.dumps(metrics, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return metrics
