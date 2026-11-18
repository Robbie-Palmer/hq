from __future__ import annotations

import hashlib
import os
import urllib.request
import zipfile
from contextlib import closing
from http.client import HTTPMessage
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory, mkstemp
from typing import IO, override
from urllib.parse import urlsplit
from xml.etree import ElementTree

from data_artifacts import files as artifact_files

from camelyon_roi_product.models import (
    AnnotationArchive,
    ArtifactManifest,
    ArtifactReference,
    Coordinate,
    LesionAnnotation,
    MetadataSource,
    SourceContract,
)
from camelyon_roi_product.product import PROJECT_DIR, ProductError, _read_json

EXPECTED_XML_SLIDES = 209
EXPECTED_LESION_ANNOTATIONS = 4865


def _digest(path: Path, algorithm: str) -> str:
    value = hashlib.new(algorithm)
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


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
            raise ProductError("CAMELYON source redirect must use HTTPS")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _download(url: str, destination: Path, max_bytes: int | None = None) -> None:
    parsed = urlsplit(url)
    if parsed.scheme != "https":
        raise ProductError("CAMELYON retrieval requires HTTPS")
    request = urllib.request.Request(  # noqa: S310 - URL is HTTPS and pinned in the contract.
        url, headers={"User-Agent": "camelyon-roi-product/0.1 (+metadata-verification)"}
    )
    opener = urllib.request.build_opener(_HttpsOnlyRedirectHandler())
    with (
        closing(opener.open(request, timeout=60)) as response,
        destination.open("wb") as target,
    ):
        written = 0
        while chunk := response.read(1024 * 1024):
            written += len(chunk)
            if max_bytes is not None and written > max_bytes:
                raise ProductError(f"download exceeds {max_bytes} byte limit")
            target.write(chunk)


def _temporary_download_path(destination: Path) -> Path:
    descriptor, name = mkstemp(
        dir=destination.parent,
        prefix=f".{destination.name}.",
        suffix=".part",
    )
    os.close(descriptor)
    return Path(name)


def _verify_metadata_file(source: MetadataSource, destination: Path) -> None:
    _download(str(source.url), destination)
    if _digest(destination, "sha256") != source.sha256:
        raise ProductError(f"official metadata changed: {source.source_id}")


def verify_metadata(root: Path = PROJECT_DIR) -> int:
    contract = SourceContract.model_validate(_read_json(root / "contracts/source.json"))
    with TemporaryDirectory(prefix="camelyon-metadata-") as temporary:
        directory = Path(temporary)
        for source in contract.metadata_sources:
            _verify_metadata_file(source, directory / source.source_id)
    return len(contract.metadata_sources)


def acquire_metadata(root: Path = PROJECT_DIR) -> int:
    contract = SourceContract.model_validate(_read_json(root / "contracts/source.json"))
    directory = root / "data/metadata"
    directory.mkdir(parents=True, exist_ok=True)
    for source in contract.metadata_sources:
        destination = directory / source.source_id
        if destination.is_file():
            if _digest(destination, "sha256") == source.sha256:
                continue
            raise ProductError(f"existing publisher metadata differs: {source.source_id}")
        temporary = _temporary_download_path(destination)
        try:
            _verify_metadata_file(source, temporary)
            temporary.replace(destination)
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    return len(contract.metadata_sources)


def _validated_xml_members(source: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    members: list[zipfile.ZipInfo] = []
    for member in source.infolist():
        path = PurePosixPath(member.filename)
        if member.is_dir():
            continue
        if path.is_absolute() or ".." in path.parts or path.suffix.lower() != ".xml":
            raise ProductError(f"unexpected annotation archive member: {member.filename}")
        members.append(member)
    return members


def _acquire_archive(archive: AnnotationArchive, root: Path) -> Path:
    destination = root / "data/raw" / archive.path
    if destination.is_file():
        if (
            destination.stat().st_size == archive.bytes
            and _digest(destination, "md5") == archive.md5
            and _digest(destination, "sha256") == archive.sha256
        ):
            return destination
        raise ProductError(f"existing annotation archive differs: {archive.path}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = _temporary_download_path(destination)
    try:
        _download(str(archive.source_url), temporary, archive.bytes)
        _require_archive_matches(temporary, archive)
        temporary.replace(destination)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return destination


def _require_archive_matches(path: Path, archive: AnnotationArchive) -> None:
    if path.stat().st_size != archive.bytes:
        raise ProductError(f"annotation archive byte count differs: {archive.path}")
    if _digest(path, "md5") != archive.md5:
        raise ProductError(f"annotation archive MD5 differs: {archive.path}")
    if _digest(path, "sha256") != archive.sha256:
        raise ProductError(f"annotation archive SHA-256 differs: {archive.path}")


def acquire_annotation_archives(root: Path = PROJECT_DIR) -> int:
    contract = SourceContract.model_validate(_read_json(root / "contracts/source.json"))
    for archive in contract.annotation_archives:
        _acquire_archive(archive, root)
    return len(contract.annotation_archives)


def _artifact_matches(path: Path, artifact: ArtifactReference) -> bool:
    return (
        path.is_file()
        and not path.is_symlink()
        and path.stat().st_size == artifact.bytes
        and _digest(path, "md5") == artifact.md5
    )


def _require_artifact_matches(path: Path, artifact: ArtifactReference) -> None:
    if not _artifact_matches(path, artifact):
        raise ProductError(f"downloaded artifact differs: {artifact.path}")


def acquire_artifact(artifact_id: str, max_bytes: int, root: Path = PROJECT_DIR) -> Path:
    payload = _read_json(root / "outputs/artifact-references.json")
    manifest = ArtifactManifest.model_validate(
        {
            "schema_version": payload["schema_version"],
            "dataset_id": payload["dataset_id"],
            "artifacts": payload["slide_artifacts"],
        }
    )
    artifacts = {artifact.artifact_id: artifact for artifact in manifest.artifacts}
    artifact = artifacts.get(artifact_id)
    if artifact is None:
        raise ProductError(f"unknown CAMELYON artifact: {artifact_id}")
    if max_bytes < artifact.bytes:
        raise ProductError(f"artifact requires {artifact.bytes} bytes, limit is {max_bytes}")
    destination = root / "data/raw" / artifact.path
    if destination.exists():
        if _artifact_matches(destination, artifact):
            return destination
        raise ProductError(f"existing artifact differs: {artifact.path}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = _temporary_download_path(destination)
    try:
        _download(str(artifact.source_url), temporary, min(max_bytes, artifact.bytes))
        _require_artifact_matches(temporary, artifact)
        temporary.replace(destination)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return destination


def _parse_xml_root(root: ElementTree.Element, slide_id: str) -> list[LesionAnnotation]:
    annotations: list[LesionAnnotation] = []
    for element in root.findall(".//Annotation"):
        coordinates = [
            Coordinate(
                order=int(coordinate.attrib["Order"]),
                x=float(coordinate.attrib["X"]),
                y=float(coordinate.attrib["Y"]),
            )
            for coordinate in element.findall("./Coordinates/Coordinate")
        ]
        coordinates.sort(key=lambda coordinate: coordinate.order)
        annotations.append(
            LesionAnnotation(
                slide_id=slide_id,
                annotation_name=element.attrib.get("Name", ""),
                annotation_type=element.attrib.get("Type", ""),
                group=element.attrib["PartOfGroup"],
                coordinates=coordinates,
            )
        )
    return annotations


def parse_xml(path: Path, slide_id: str) -> list[LesionAnnotation]:
    root = ElementTree.parse(path).getroot()  # noqa: S314 - publisher XML contains no DTD.
    return _parse_xml_root(root, slide_id)


def index_annotations(root: Path = PROJECT_DIR) -> int:
    contract = SourceContract.model_validate(_read_json(root / "contracts/source.json"))
    parsed: list[LesionAnnotation] = []
    xml_count = 0
    for archive in contract.annotation_archives:
        archive_path = root / "data/raw" / archive.path
        _require_archive_matches(archive_path, archive)
        with zipfile.ZipFile(archive_path) as source:
            for member in sorted(_validated_xml_members(source), key=lambda value: value.filename):
                xml_count += 1
                document = ElementTree.fromstring(  # noqa: S314 - pinned publisher XML has no DTD.
                    source.read(member)
                )
                parsed.extend(_parse_xml_root(document, Path(member.filename).stem))
    if xml_count != EXPECTED_XML_SLIDES or len(parsed) != EXPECTED_LESION_ANNOTATIONS:
        raise ProductError("publisher XML produced unexpected annotation scope")
    output = artifact_files.resolve_under(root, "outputs")
    artifact_files.write_jsonl(
        artifact_files.resolve_under(output, "lesion-annotations.jsonl"),
        (annotation.model_dump(mode="json") for annotation in parsed),
    )
    artifact_files.write_json(
        artifact_files.resolve_under(output, "annotation-metrics.json"),
        {"lesion_annotation_count": len(parsed), "xml_annotated_slide_count": xml_count},
    )
    return len(parsed)


def acquire_annotations(root: Path = PROJECT_DIR) -> int:
    acquire_annotation_archives(root)
    return index_annotations(root)
