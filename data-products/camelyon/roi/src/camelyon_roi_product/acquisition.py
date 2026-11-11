from __future__ import annotations

import hashlib
import json
import shutil
import urllib.request
import zipfile
from contextlib import closing
from http.client import HTTPMessage
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory
from typing import IO, override
from urllib.parse import urlsplit
from xml.etree import ElementTree

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


def _download(url: str, destination: Path) -> None:
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
        shutil.copyfileobj(response, target, length=1024 * 1024)


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


def _safe_extract(source: zipfile.ZipFile, destination: Path) -> None:
    for member in source.infolist():
        path = PurePosixPath(member.filename)
        if member.is_dir():
            continue
        if path.is_absolute() or ".." in path.parts or path.suffix.lower() != ".xml":
            raise ProductError(f"unexpected annotation archive member: {member.filename}")
        target = destination / Path(*path.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        with source.open(member) as input_stream, target.open("wb") as output_stream:
            shutil.copyfileobj(input_stream, output_stream)


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
    temporary = destination.with_name(f".{destination.name}.part")
    temporary.unlink(missing_ok=True)
    try:
        _download(str(archive.source_url), temporary)
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
    manifest = ArtifactManifest.model_validate(_read_json(root / "contracts/artifacts.json"))
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
    temporary = destination.with_name(f".{destination.name}.part")
    temporary.unlink(missing_ok=True)
    try:
        _download(str(artifact.source_url), temporary)
        _require_artifact_matches(temporary, artifact)
        temporary.replace(destination)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return destination


def parse_xml(path: Path, slide_id: str) -> list[LesionAnnotation]:
    root = ElementTree.parse(path).getroot()  # noqa: S314 - publisher XML contains no DTD.
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


def acquire_annotations(root: Path = PROJECT_DIR) -> int:
    contract = SourceContract.model_validate(_read_json(root / "contracts/source.json"))
    records_payload = _read_json(root / "records/native-records.json")
    annotation_by_member = {
        record["lesion_annotation"]["archive_member"]: record["slide_id"]
        for record in records_payload["records"]
        if record["lesion_annotation"] is not None
    }
    extracted = root / "data/annotations"
    shutil.rmtree(extracted, ignore_errors=True)
    parsed: list[LesionAnnotation] = []
    for archive in contract.annotation_archives:
        archive_path = _acquire_archive(archive, root)
        archive_root = extracted / archive.artifact_id
        with zipfile.ZipFile(archive_path) as source:
            _safe_extract(source, archive_root)
        for path in sorted(archive_root.rglob("*.xml")):
            member = path.relative_to(archive_root).as_posix()
            slide_id = annotation_by_member.get(member)
            if slide_id is None:
                raise ProductError(f"unreferenced publisher annotation: {member}")
            parsed.extend(parse_xml(path, slide_id))
    output = root / "data/annotation-index.jsonl"
    output.write_text(
        "".join(
            json.dumps(annotation.model_dump(mode="json"), sort_keys=True) + "\n"
            for annotation in parsed
        ),
        encoding="utf-8",
    )
    return len(parsed)
