from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import urllib.request
import zipfile
from collections import Counter
from contextlib import closing
from dataclasses import dataclass
from email.message import Message
from http.client import HTTPMessage
from pathlib import Path, PurePosixPath
from typing import IO, Literal, Protocol, TypedDict, cast, override
from urllib.parse import urlsplit

from defusedxml import ElementTree

from monusac_source_data.models import (
    AcquisitionEvidence,
    ArtifactEvidence,
    CellClassName,
    NativeAnnotationGroup,
    NativeImageMember,
    NativeImageRecord,
    NativeInstanceAnnotation,
    OrganRoleContract,
    PatientRole,
    PublisherRole,
    PublisherSplit,
    RemoteArtifactEvidence,
    SourceArtifact,
    SourceManifest,
    Vertex,
)

PROJECT_DIR = Path(__file__).resolve().parents[2]
_CELL_CLASSES: set[CellClassName] = {
    "Epithelial",
    "Lymphocyte",
    "Macrophage",
    "Neutrophil",
    "Ambiguous",
}


class SourceDataError(RuntimeError):
    pass


@dataclass(frozen=True)
class AnnotationDocument:
    microns_per_pixel: float
    groups: tuple[NativeAnnotationGroup, ...]
    annotations: tuple[NativeInstanceAnnotation, ...]


class MetadataEvidence(TypedDict):
    schema_version: str
    dataset_id: str
    artifact_refs: list[str]
    patient_roles: dict[str, int]
    organs: list[Literal["Breast", "Kidney", "Lung", "Prostate"]]
    patient_ids_in_both_publisher_splits: list[str]
    checksums: str
    dataset_bytes_required: bool


class _UrlResponse(Protocol):
    headers: Message

    def read(self, size: int = -1, /) -> bytes: ...

    def close(self) -> None: ...

    def geturl(self) -> str: ...


def load_manifest(root: Path = PROJECT_DIR) -> SourceManifest:
    return SourceManifest.model_validate_json((root / "manifest.json").read_text(encoding="utf-8"))


def load_organ_roles(root: Path = PROJECT_DIR) -> OrganRoleContract:
    path = root / "contracts/organ-roles.json"
    return OrganRoleContract.model_validate_json(path.read_text(encoding="utf-8"))


def _digest(path: Path, algorithm: str) -> str:
    digest = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_artifact(path: Path, artifact: SourceArtifact) -> None:
    if not path.is_file() or path.is_symlink():
        raise SourceDataError(f"missing regular source artifact: {path}")
    if path.stat().st_size != artifact.bytes:
        raise SourceDataError(f"artifact byte count differs for {artifact.name}")
    if _digest(path, "md5") != artifact.md5:
        raise SourceDataError(f"artifact MD5 differs for {artifact.name}")
    if _digest(path, "sha256") != artifact.sha256:
        raise SourceDataError(f"artifact SHA-256 differs for {artifact.name}")


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
            raise SourceDataError("source artifact redirect must use HTTPS")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _open_url(request: urllib.request.Request, *, timeout: int) -> _UrlResponse:
    response = urllib.request.build_opener(_HttpsOnlyRedirectHandler()).open(
        request, timeout=timeout
    )
    return cast(_UrlResponse, response)


def _download(artifact: SourceArtifact, destination: Path) -> None:
    temporary = destination.with_name(f".{destination.name}.part")
    temporary.unlink(missing_ok=True)
    request = urllib.request.Request(  # noqa: S310 - manifest constrains URLs to HTTPS.
        str(artifact.download_url),
        headers={"User-Agent": "monusac-source-data/0.1 (+source-registry)"},
    )
    try:
        with closing(_open_url(request, timeout=60)) as response, temporary.open("wb") as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
            output.flush()
            os.fsync(output.fileno())
        verify_artifact(temporary, artifact)
        temporary.replace(destination)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def acquire_dataset(root: Path = PROJECT_DIR) -> AcquisitionEvidence:
    manifest = load_manifest(root)
    raw_root = root / "data/raw"
    raw_root.mkdir(parents=True, exist_ok=True)
    evidence: list[ArtifactEvidence] = []
    for artifact in manifest.artifacts:
        destination = raw_root / artifact.filename
        if destination.exists():
            verify_artifact(destination, artifact)
        else:
            _download(artifact, destination)
        evidence.append(
            ArtifactEvidence(
                artifact_ref=artifact.artifact_ref,
                filename=artifact.filename,
                bytes=artifact.bytes,
                md5=artifact.md5,
                sha256=artifact.sha256,
            )
        )
    result = AcquisitionEvidence(dataset_id=manifest.dataset_id, artifacts=evidence)
    (raw_root / "acquisition-evidence.json").write_text(
        result.model_dump_json(indent=2) + "\n", encoding="utf-8"
    )
    return result


def _header_filename(headers: Message) -> str | None:
    filename = headers.get_filename()
    if filename is not None:
        return filename
    disposition = headers.get("Content-Disposition")
    if not disposition or "filename=" not in disposition:
        return None
    return disposition.split("filename=", 1)[1].strip().strip('"')


def probe_remote_artifacts(root: Path = PROJECT_DIR) -> list[RemoteArtifactEvidence]:
    manifest = load_manifest(root)
    evidence: list[RemoteArtifactEvidence] = []
    for artifact in manifest.artifacts:
        request = urllib.request.Request(  # noqa: S310 - manifest constrains URLs to HTTPS.
            str(artifact.download_url),
            method="HEAD",
            headers={"User-Agent": "monusac-source-data/0.1 (+metadata-probe)"},
        )
        with closing(_open_url(request, timeout=60)) as response:
            headers = response.headers
            final_url = response.geturl()
            filename = _header_filename(headers)
            size = int(headers.get("Content-Length", "0"))
            last_modified = headers.get("Last-Modified", "")
        if urlsplit(final_url).scheme.lower() != "https":
            raise SourceDataError(f"remote artifact resolved outside HTTPS: {artifact.name}")
        if filename != artifact.filename:
            raise SourceDataError(f"remote filename differs for {artifact.name}")
        if size != artifact.bytes:
            raise SourceDataError(f"remote byte count differs for {artifact.name}")
        if last_modified != artifact.last_modified:
            raise SourceDataError(f"remote last-modified differs for {artifact.name}")
        evidence.append(
            RemoteArtifactEvidence(
                artifact_ref=artifact.artifact_ref,
                final_url=final_url,
                filename=filename,
                bytes=size,
                last_modified=last_modified,
            )
        )
    return evidence


def _role_map(contract: OrganRoleContract) -> dict[tuple[PublisherSplit, str], PatientRole]:
    return {(role.publisher_split, role.patient_id): role for role in contract.patient_roles}


def verify_metadata(root: Path = PROJECT_DIR, output: Path | None = None) -> MetadataEvidence:
    manifest = load_manifest(root)
    contract = load_organ_roles(root)
    role_counts = Counter(role.publisher_split for role in contract.patient_roles)
    for split in ("training", "testing"):
        expected = getattr(manifest.expected, split).patient_role_count
        if role_counts[split] != expected:
            raise SourceDataError(f"{split} patient-role count differs from the manifest")
    organs = {role.organ for role in contract.patient_roles}
    if organs != set(manifest.expected.organs):
        raise SourceDataError("organ-role contract does not contain every native organ")
    training = {
        role.patient_id for role in contract.patient_roles if role.publisher_split == "training"
    }
    testing = {
        role.patient_id for role in contract.patient_roles if role.publisher_split == "testing"
    }
    result: MetadataEvidence = {
        "schema_version": "1.0.0",
        "dataset_id": manifest.dataset_id,
        "artifact_refs": [artifact.artifact_ref for artifact in manifest.artifacts],
        "patient_roles": dict(sorted(role_counts.items())),
        "organs": manifest.expected.organs,
        "patient_ids_in_both_publisher_splits": sorted(training & testing),
        "checksums": "pinned_repository_observations",
        "dataset_bytes_required": False,
    }
    if output is not None:
        destination = output if output.is_absolute() else root / output
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(
            json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
    return result


def _safe_members(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    members = archive.infolist()
    for member in members:
        path = PurePosixPath(member.filename)
        mode = member.external_attr >> 16
        if path.is_absolute() or ".." in path.parts or stat.S_ISLNK(mode):
            raise SourceDataError(f"unsafe archive member: {member.filename}")
    return members


def _optional_float(value: str | None) -> float | None:
    return float(value) if value not in {None, ""} else None


def _publisher_role(
    cell_class: str,
) -> Literal["challenge_scored_nucleus", "challenge_excluded_region"]:
    return "challenge_excluded_region" if cell_class == "Ambiguous" else "challenge_scored_nucleus"


def _parse_annotation_document(payload: bytes, *, include_instances: bool) -> AnnotationDocument:
    root = ElementTree.fromstring(payload)
    microns_per_pixel = float(root.attrib["MicronsPerPixel"])
    groups: list[NativeAnnotationGroup] = []
    annotations: list[NativeInstanceAnnotation] = []
    for annotation in root.findall("Annotation"):
        group_id = int(annotation.attrib["Id"])
        group_name = annotation.attrib.get("Name", "")
        line_color = int(annotation.attrib["LineColor"])
        attribute = annotation.find("./Attributes/Attribute")
        source_attribute_name = attribute.attrib["Name"] if attribute is not None else ""
        regions = annotation.findall("./Regions/Region")
        cell_class: CellClassName | None = (
            cast(CellClassName, source_attribute_name)
            if source_attribute_name in _CELL_CLASSES
            else None
        )
        if regions and cell_class is None:
            raise SourceDataError(
                f"annotation group {group_id} has regions under unknown class "
                f"{source_attribute_name!r}"
            )
        role: PublisherRole = (
            _publisher_role(cell_class) if cell_class is not None else "empty_annotation_group"
        )
        groups.append(
            NativeAnnotationGroup(
                annotation_group_id=group_id,
                annotation_group_name=group_name,
                source_attribute_name=source_attribute_name,
                cell_class=cell_class,
                publisher_role=role,
                line_color=line_color,
                instance_count=len(regions),
            )
        )
        if not include_instances or cell_class is None:
            continue
        for region in regions:
            vertices = [
                Vertex(
                    x=float(item.attrib["X"]),
                    y=float(item.attrib["Y"]),
                    z=float(item.attrib["Z"]),
                )
                for item in region.findall("./Vertices/Vertex")
            ]
            if not vertices:
                raise SourceDataError(f"annotation region {region.attrib['Id']} has no vertices")
            annotations.append(
                NativeInstanceAnnotation(
                    annotation_group_id=group_id,
                    annotation_group_name=group_name,
                    source_attribute_name=source_attribute_name,
                    cell_class=cell_class,
                    publisher_role=_publisher_role(cell_class),
                    region_id=int(region.attrib["Id"]),
                    region_type=int(region.attrib["Type"]),
                    negative_roa=region.attrib.get("NegativeROA") == "1",
                    length=_optional_float(region.attrib.get("Length")),
                    area=_optional_float(region.attrib.get("Area")),
                    length_microns=_optional_float(region.attrib.get("LengthMicrons")),
                    area_microns=_optional_float(region.attrib.get("AreaMicrons")),
                    vertices=vertices,
                )
            )
    return AnnotationDocument(
        microns_per_pixel=microns_per_pixel,
        groups=tuple(groups),
        annotations=tuple(annotations),
    )


def load_annotations(payload: bytes) -> AnnotationDocument:
    return _parse_annotation_document(payload, include_instances=True)


def _patient_id(slide_id: str) -> str:
    parts = slide_id.split("-")
    if len(parts) < 3:
        raise SourceDataError(f"invalid TCGA slide ID: {slide_id}")
    return "-".join(parts[:3])


def _artifact_ref(artifact: SourceArtifact) -> str:
    return artifact.artifact_ref


def _record_ref(split: PublisherSplit, image_id: str) -> str:
    return f"monusac2020-challenge-distribution-20210608:record:{split}:{image_id}"


def _member_kind(path: str) -> str:
    return PurePosixPath(path).suffix.lower().removeprefix(".")


def _index_archive(
    path: Path,
    artifact: SourceArtifact,
    roles: dict[tuple[PublisherSplit, str], PatientRole],
) -> tuple[list[NativeImageRecord], Counter[str], set[str], set[str]]:
    if artifact.publisher_split is None:
        raise SourceDataError("organ evidence is not a dataset archive")
    split = artifact.publisher_split
    records: list[NativeImageRecord] = []
    format_counts: Counter[str] = Counter()
    patients: set[str] = set()
    slides: set[str] = set()
    with zipfile.ZipFile(path) as archive:
        files = [member.filename for member in _safe_members(archive) if not member.is_dir()]
        members_by_stem: dict[tuple[str, str], dict[str, str]] = {}
        for member in files:
            suffix = _member_kind(member)
            if suffix not in {"svs", "tif", "xml"}:
                continue
            member_path = PurePosixPath(member)
            key = (member_path.parent.as_posix(), member_path.stem)
            members_by_stem.setdefault(key, {})[suffix] = member
        for (parent, image_id), image_members in sorted(members_by_stem.items()):
            if "xml" not in image_members:
                raise SourceDataError(f"image has no annotation XML: {parent}/{image_id}")
            if "svs" not in image_members:
                raise SourceDataError(f"annotation has no native SVS image: {parent}/{image_id}")
            slide_id = PurePosixPath(parent).name
            patient_id = _patient_id(slide_id)
            role = roles.get((split, patient_id))
            if role is None:
                raise SourceDataError(f"no publisher organ role for {split} patient {patient_id}")
            document = _parse_annotation_document(
                archive.read(image_members["xml"]), include_instances=False
            )
            class_counts: Counter[str] = Counter()
            publisher_role_counts: Counter[str] = Counter()
            for group in document.groups:
                if group.cell_class is not None:
                    class_counts[group.cell_class] += group.instance_count
                publisher_role_counts[group.publisher_role] += group.instance_count
            native_images = [
                NativeImageMember(
                    format=image_format,
                    artifact_ref=_artifact_ref(artifact),
                    member_path=image_members[image_format],
                )
                for image_format in ("svs", "tif")
                if image_format in image_members
            ]
            format_counts.update((*image_members,))
            patients.add(patient_id)
            slides.add(slide_id)
            records.append(
                NativeImageRecord(
                    dataset_id="monusac2020-challenge-distribution-20210608",
                    record_ref=_record_ref(split, image_id),
                    image_id=image_id,
                    slide_id=slide_id,
                    patient_id=patient_id,
                    publisher_split=split,
                    organ=role.organ,
                    tissue_source_site_code=role.tissue_source_site_code,
                    hospital=role.hospital,
                    image_members=native_images,
                    annotation_artifact_ref=_artifact_ref(artifact),
                    annotation_member_path=image_members["xml"],
                    microns_per_pixel=document.microns_per_pixel,
                    annotation_groups=list(document.groups),
                    instance_count=sum(class_counts.values()),
                    cell_class_counts=dict(sorted(class_counts.items())),
                    publisher_role_counts=dict(sorted(publisher_role_counts.items())),
                )
            )
    return records, format_counts, patients, slides


def _validate_split(
    manifest: SourceManifest,
    split: PublisherSplit,
    records: list[NativeImageRecord],
    formats: Counter[str],
    patients: set[str],
) -> None:
    expected = getattr(manifest.expected, split)
    scored = sum(
        record.publisher_role_counts.get("challenge_scored_nucleus", 0) for record in records
    )
    ambiguous = sum(
        record.publisher_role_counts.get("challenge_excluded_region", 0) for record in records
    )
    observed = {
        "patient_role_count": len(patients),
        "image_count": len(records),
        "svs_count": formats["svs"],
        "tif_count": formats["tif"],
        "xml_count": formats["xml"],
        "scored_instance_count": scored,
        "ambiguous_instance_count": ambiguous,
        "cell_class_counts": dict(
            sorted(
                Counter(
                    {
                        cell_class: sum(
                            record.cell_class_counts.get(cell_class, 0) for record in records
                        )
                        for cell_class in _CELL_CLASSES
                        if any(cell_class in record.cell_class_counts for record in records)
                    }
                ).items()
            )
        ),
    }
    if observed != expected.model_dump():
        raise SourceDataError(
            f"{split} source counts differ: expected {expected.model_dump()}, observed {observed}"
        )


def index_dataset(root: Path = PROJECT_DIR) -> dict[str, object]:
    manifest = load_manifest(root)
    roles = _role_map(load_organ_roles(root))
    raw_root = root / "data/raw"
    all_records: list[NativeImageRecord] = []
    split_patients: dict[PublisherSplit, set[str]] = {"training": set(), "testing": set()}
    split_slides: dict[PublisherSplit, set[str]] = {"training": set(), "testing": set()}
    for artifact in manifest.artifacts:
        path = raw_root / artifact.filename
        verify_artifact(path, artifact)
        if artifact.publisher_split is None:
            continue
        records, formats, patients, slides = _index_archive(path, artifact, roles)
        _validate_split(manifest, artifact.publisher_split, records, formats, patients)
        all_records.extend(records)
        split_patients[artifact.publisher_split] = patients
        split_slides[artifact.publisher_split] = slides
    all_records.sort(key=lambda item: item.record_ref)
    output_root = root / "outputs"
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "native-index.jsonl").write_text(
        "".join(
            json.dumps(record.model_dump(mode="json"), sort_keys=True) + "\n"
            for record in all_records
        ),
        encoding="utf-8",
    )
    records_by_split = Counter(record.publisher_split for record in all_records)
    images_by_organ = Counter(record.organ for record in all_records)
    instances_by_class: Counter[str] = Counter()
    instances_by_role: Counter[str] = Counter()
    for record in all_records:
        instances_by_class.update(record.cell_class_counts)
        instances_by_role.update(record.publisher_role_counts)
    metrics: dict[str, object] = {
        "dataset_id": manifest.dataset_id,
        "record_count": len(all_records),
        "records_by_publisher_split": dict(sorted(records_by_split.items())),
        "images_by_organ": dict(sorted(images_by_organ.items())),
        "instances_by_cell_class": dict(sorted(instances_by_class.items())),
        "instances_by_publisher_role": dict(sorted(instances_by_role.items())),
        "patient_ids_in_both_publisher_splits": sorted(
            split_patients["training"] & split_patients["testing"]
        ),
        "slide_ids_in_both_publisher_splits": sorted(
            split_slides["training"] & split_slides["testing"]
        ),
    }
    (output_root / "source-metrics.json").write_text(
        json.dumps(metrics, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return metrics
