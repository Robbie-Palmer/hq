from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import stat
import urllib.request
import zipfile
from collections import Counter, defaultdict
from collections.abc import Iterable
from http.client import HTTPMessage
from pathlib import Path, PurePosixPath
from typing import IO, Any, Literal, override
from urllib.parse import urlsplit

from openpyxl import load_workbook

from sicapv2_source_data.models import (
    OriginalArtifact,
    PatchCoordinates,
    PatchRecord,
    PatientRecord,
    PublishedPatchLabels,
    PublishedRole,
    SlideRecord,
    SourceManifest,
)

PROJECT_DIR = Path(__file__).resolve().parents[2]
ARCHIVE_REF = "mendeley:9xxm58dvs3:v2:file:6ab087a7-ca89-47ac-9698-f6546bb50f98"
PUBLIC_API = "https://data.mendeley.com/public-api"
PATCH_PATTERN = re.compile(
    r"^(?P<slide_id>.+)_Block_Region_(?P<region>\d+)_(?P<row>\d+)_(?P<column>\d+)"
    r"_xini_(?P<xini>\d+)_yini_(?P<yini>\d+)\.jpg$"
)


class SourceDataError(RuntimeError):
    pass


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
            raise SourceDataError("publisher redirect must use HTTPS")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def load_manifest(root: Path = PROJECT_DIR) -> SourceManifest:
    return SourceManifest.model_validate_json((root / "manifest.json").read_text(encoding="utf-8"))


def _digest(path: Path, algorithm: str) -> str:
    digest = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _json_request(url: str) -> object:
    request = urllib.request.Request(  # noqa: S310 - only fixed HTTPS Mendeley endpoints are used.
        url,
        headers={
            "Accept": "application/vnd.mendeley-public-dataset.1+json",
            "User-Agent": "sicapv2-source-data/0.1 (+metadata-verifier)",
        },
    )
    opener = urllib.request.build_opener(_HttpsOnlyRedirectHandler())
    with opener.open(request, timeout=60) as response:
        return json.load(response)


def _require_equal(actual: object, expected: object, field: str) -> None:
    if actual != expected:
        raise SourceDataError(f"Mendeley {field} differs: expected {expected!r}, found {actual!r}")


def verify_publisher_metadata(root: Path = PROJECT_DIR) -> dict[str, object]:
    manifest = load_manifest(root)
    dataset_url = (
        f"{PUBLIC_API}/datasets/{manifest.publisher_dataset_id}"
        f"?version={manifest.publisher_version}"
    )
    files_url = (
        f"{PUBLIC_API}/datasets/{manifest.publisher_dataset_id}/files?folder_id=root"
        f"&version={manifest.publisher_version}&$start=0&$limit=1000"
    )
    versions_url = f"{PUBLIC_API}/datasets/{manifest.publisher_dataset_id}/versions"
    dataset = _json_request(dataset_url)
    files = _json_request(files_url)
    versions = _json_request(versions_url)
    if (
        not isinstance(dataset, dict)
        or not isinstance(files, list)
        or not isinstance(versions, list)
    ):
        raise SourceDataError("Mendeley returned an unexpected metadata shape")
    _require_equal(dataset.get("id"), manifest.publisher_dataset_id, "dataset ID")
    doi = dataset.get("doi")
    _require_equal(doi.get("id") if isinstance(doi, dict) else None, manifest.doi, "DOI")
    _require_equal(dataset.get("version"), manifest.publisher_version, "version")
    _require_equal(dataset.get("name"), manifest.title, "title")
    _require_equal(dataset.get("publish_date"), manifest.published_at, "publish date")
    licence = dataset.get("data_licence")
    if not isinstance(licence, dict):
        raise SourceDataError("Mendeley record does not contain rights metadata")
    _require_equal(licence.get("short_name"), "CC BY 4.0", "license")
    _require_equal(licence.get("full_name"), manifest.license.name, "license name")
    contributors = dataset.get("contributors")
    if not isinstance(contributors, list) or len(contributors) != 1:
        raise SourceDataError("Mendeley contributor list differs")
    contributor = contributors[0]
    if not isinstance(contributor, dict):
        raise SourceDataError("Mendeley contributor has an unexpected shape")
    _require_equal(contributor.get("profile_id"), manifest.contributor.profile_id, "contributor")
    _require_equal(
        f"{contributor.get('first_name')} {contributor.get('last_name')}",
        manifest.contributor.name,
        "contributor name",
    )
    if len(files) != 1 or not isinstance(files[0], dict):
        raise SourceDataError("Mendeley version 2 must contain exactly one root file")
    source_file = files[0]
    content = source_file.get("content_details")
    if not isinstance(content, dict):
        raise SourceDataError("Mendeley file does not contain content details")
    expected_file = manifest.archive
    _require_equal(source_file.get("id"), expected_file.file_id, "archive file ID")
    _require_equal(source_file.get("filename"), expected_file.filename, "archive filename")
    _require_equal(source_file.get("size"), expected_file.bytes, "archive byte count")
    _require_equal(content.get("sha256_hash"), expected_file.sha256, "archive SHA-256")
    _require_equal(content.get("content_type"), expected_file.content_type, "archive media type")
    version_rows = [row for row in versions if isinstance(row, dict)]
    if not any(
        row.get("version") == manifest.publisher_version
        and str(row.get("publish_date", "")).startswith("2020-10-22")
        and row.get("available") is True
        for row in version_rows
    ):
        raise SourceDataError("Mendeley version history does not contain available version 2")
    result: dict[str, object] = {
        "schema_version": "1.0.0",
        "verification_scope": "publisher_metadata_only",
        "credentials_required": False,
        "archive_bytes_downloaded": False,
        "dataset_id": manifest.dataset_id,
        "publisher_dataset_id": manifest.publisher_dataset_id,
        "publisher_version": manifest.publisher_version,
        "doi": manifest.doi,
        "license": manifest.license.spdx_id,
        "contributor_profile_id": manifest.contributor.profile_id,
        "archive": {
            "file_id": expected_file.file_id,
            "filename": expected_file.filename,
            "bytes": expected_file.bytes,
            "sha256": expected_file.sha256,
            "content_type": expected_file.content_type,
        },
        "verified": True,
    }
    output = root / "records/publisher-metadata.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.is_file():
        committed = json.loads(output.read_text(encoding="utf-8"))
        if committed != result:
            raise SourceDataError(
                "committed publisher metadata differs from live Mendeley metadata"
            )
    else:
        output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return result


def verify_archive(path: Path, manifest: SourceManifest) -> None:
    if not path.is_file() or path.is_symlink():
        raise SourceDataError(f"missing regular SICAPv2 archive: {path}")
    if path.stat().st_size != manifest.archive.bytes:
        raise SourceDataError(f"SICAPv2 archive byte count differs: {path}")
    if _digest(path, "sha256") != manifest.archive.sha256:
        raise SourceDataError(f"SICAPv2 archive SHA-256 differs: {path}")


def acquire_archive(root: Path = PROJECT_DIR) -> Path:
    manifest = load_manifest(root)
    destination = root / "data/raw" / manifest.archive.filename
    if destination.is_file():
        verify_archive(destination, manifest)
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".zip.part")
    temporary.unlink(missing_ok=True)
    request = urllib.request.Request(  # noqa: S310 - manifest constrains the URL to HTTPS.
        str(manifest.archive.url),
        headers={"User-Agent": "sicapv2-source-data/0.1 (+source-product)"},
    )
    opener = urllib.request.build_opener(_HttpsOnlyRedirectHandler())
    try:
        with opener.open(request, timeout=60) as response, temporary.open("wb") as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
            output.flush()
            os.fsync(output.fileno())
        verify_archive(temporary, manifest)
        temporary.replace(destination)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return destination


def _safe_infos(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    infos = archive.infolist()
    for info in infos:
        path = PurePosixPath(info.filename)
        mode = info.external_attr >> 16
        if path.is_absolute() or ".." in path.parts or stat.S_ISLNK(mode):
            raise SourceDataError(f"unsafe SICAPv2 archive member: {info.filename}")
    return infos


def _artifact(info: zipfile.ZipInfo) -> OriginalArtifact:
    suffix = PurePosixPath(info.filename).suffix.lower()
    media_types = {
        ".jpg": "image/jpeg",
        ".txt": "text/plain",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
    if suffix not in media_types:
        raise SourceDataError(f"unknown SICAPv2 artifact media type: {info.filename}")
    return OriginalArtifact(
        artifact_ref=f"sicapv2:v2:artifact:{info.filename}",
        archive_ref=ARCHIVE_REF,
        member_path=info.filename,
        bytes=info.file_size,
        crc32=f"{info.CRC:08x}",
        media_type=media_types[suffix],
    )


def _table_rows(archive: zipfile.ZipFile, path: str) -> list[dict[str, object]]:
    try:
        payload = archive.read(path)
    except KeyError as error:
        raise SourceDataError(f"missing SICAPv2 table: {path}") from error
    workbook = load_workbook(io.BytesIO(payload), read_only=True, data_only=True)
    try:
        sheet = workbook.active
        if sheet is None:
            raise SourceDataError(f"SICAPv2 table has no active sheet: {path}")
        values = sheet.iter_rows(values_only=True)
        header = next(values, None)
        if header is None or any(value is None for value in header):
            raise SourceDataError(f"SICAPv2 table has an invalid header: {path}")
        names = [str(value) for value in header]
        return [dict(zip(names, row, strict=True)) for row in values]
    finally:
        workbook.close()


def parse_patch_name(filename: str) -> tuple[str, PatchCoordinates]:
    match = PATCH_PATTERN.fullmatch(filename)
    if match is None:
        raise SourceDataError(f"invalid SICAPv2 patch filename: {filename}")
    values = match.groupdict()
    return values["slide_id"], PatchCoordinates(
        region=int(values["region"]),
        row=int(values["row"]),
        column=int(values["column"]),
        xini=int(values["xini"]),
        yini=int(values["yini"]),
    )


def grade_group(primary: int, secondary: int) -> int:
    pair = (primary, secondary)
    if pair == (0, 0):
        return 0
    mapping = {
        (3, 3): 1,
        (3, 4): 2,
        (4, 3): 3,
        (4, 4): 4,
        (3, 5): 4,
        (5, 3): 4,
        (4, 5): 5,
        (5, 4): 5,
        (5, 5): 5,
    }
    if pair not in mapping:
        raise SourceDataError(f"unknown published Gleason score: {primary}+{secondary}")
    return mapping[pair]


def _int_field(row: dict[str, object], field: str, table: str) -> int:
    value = row.get(field)
    if isinstance(value, bool) or not isinstance(value, int | float) or int(value) != value:
        raise SourceDataError(f"{table}: {field} must be an integer")
    return int(value)


def _partition_tables(
    archive: zipfile.ZipFile,
    infos: dict[str, zipfile.ZipInfo],
    manifest: SourceManifest,
) -> tuple[dict[str, PublishedPatchLabels], dict[str, list[PublishedRole]], list[OriginalArtifact]]:
    labels: dict[str, PublishedPatchLabels] = {}
    roles: dict[str, list[PublishedRole]] = defaultdict(list)
    artifacts: list[OriginalArtifact] = []
    for partition in manifest.published_partitions:
        for role_name in ("Train", "Test"):
            role: Literal["train", "test"] = "train" if role_name == "Train" else "test"
            for task, suffix in (("gleason_grading", ""), ("cribriform_detection", "Cribfriform")):
                path = f"{partition.path}/{role_name}{suffix}.xlsx"
                info = infos.get(path)
                if info is None:
                    raise SourceDataError(f"missing SICAPv2 partition artifact: {path}")
                artifact = _artifact(info)
                artifacts.append(artifact)
                for row in _table_rows(archive, path):
                    image_name = row.get("image_name")
                    if not isinstance(image_name, str) or not image_name:
                        raise SourceDataError(f"{path}: invalid image_name")
                    published_role = PublishedRole(
                        partition_id=partition.id,
                        task=task,
                        role=role,
                        table_artifact_ref=artifact.artifact_ref,
                    )
                    if any(
                        existing.partition_id == published_role.partition_id
                        and existing.task == published_role.task
                        for existing in roles[image_name]
                    ):
                        raise SourceDataError(
                            f"{image_name}: duplicate role in {partition.id} {task} tables"
                        )
                    roles[image_name].append(published_role)
                    if task == "cribriform_detection":
                        continue
                    patch_labels = PublishedPatchLabels(
                        **{
                            field: _int_field(row, field, path)
                            for field in manifest.published_patch_labels
                        }
                    )
                    existing = labels.setdefault(image_name, patch_labels)
                    if existing != patch_labels:
                        raise SourceDataError(
                            f"{image_name}: published labels differ across partitions"
                        )
    return labels, roles, artifacts


def _slide_rows(
    archive: zipfile.ZipFile, info: zipfile.ZipInfo
) -> tuple[dict[str, SlideRecord], OriginalArtifact]:
    path = info.filename
    artifact = _artifact(info)
    slides: dict[str, SlideRecord] = {}
    for row in _table_rows(archive, path):
        slide_id = row.get("slide_id")
        patient_value = row.get("patient_id")
        if not isinstance(slide_id, str) or not isinstance(patient_value, int | str):
            raise SourceDataError(f"{path}: invalid slide or patient identity")
        patient_id = str(patient_value)
        primary = _int_field(row, "Gleason_primary", path)
        secondary = _int_field(row, "Gleason_secondary", path)
        score = (
            "NC"
            if (primary, secondary) == (0, 0)
            else f"{primary}+{secondary}={primary + secondary}"
        )
        record = SlideRecord(
            record_ref=f"sicapv2:v2:slide:{slide_id}",
            slide_id=slide_id,
            patient_ref=f"sicapv2:v2:patient:{patient_id}",
            patient_id=patient_id,
            gleason_primary=primary,
            gleason_secondary=secondary,
            global_gleason_score=score,
            grade_group=grade_group(primary, secondary),
            grade_group_provenance="lossless_isup_mapping_from_published_primary_secondary",
            source_table_artifact_ref=artifact.artifact_ref,
            patch_refs=[],
        )
        if slide_id in slides:
            raise SourceDataError(f"duplicate SICAPv2 slide identity: {slide_id}")
        slides[slide_id] = record
    return slides, artifact


def _json_lines(records: Iterable[PatientRecord | SlideRecord | PatchRecord]) -> str:
    return "".join(
        json.dumps(record.model_dump(mode="json"), sort_keys=True) + "\n" for record in records
    )


def _write_outputs(
    root: Path,
    manifest: SourceManifest,
    patients: list[PatientRecord],
    slides: list[SlideRecord],
    patches: list[PatchRecord],
    table_artifacts: list[OriginalArtifact],
) -> dict[str, object]:
    role_counts = Counter(
        f"{role.partition_id}:{role.task}:{role.role}"
        for patch in patches
        for role in patch.published_roles
    )
    label_counts: Counter[str] = Counter()
    for patch in patches:
        if patch.published_labels is None:
            continue
        for name, value in patch.published_labels.model_dump().items():
            label_counts[name] += value
    labelled_patch_count = sum(patch.published_labels is not None for patch in patches)
    if labelled_patch_count != manifest.expected.published_labelled_patch_count:
        raise SourceDataError("SICAPv2 published labelled-patch count differs from the manifest")
    expected_label_counts = manifest.expected.published_patch_label_counts.model_dump()
    if dict(label_counts) != expected_label_counts:
        raise SourceDataError("SICAPv2 published patch-label counts differ from the manifest")
    metrics: dict[str, object] = {
        "dataset_id": manifest.dataset_id,
        "patient_count": len(patients),
        "slide_count": len(slides),
        "patch_count": len(patches),
        "paired_mask_count": len(patches),
        "published_labelled_patch_count": labelled_patch_count,
        "published_patch_label_counts": dict(sorted(label_counts.items())),
        "published_role_counts": dict(sorted(role_counts.items())),
        "global_gleason_score_counts": dict(
            sorted(Counter(slide.global_gleason_score for slide in slides).items())
        ),
        "grade_group_counts": dict(
            sorted(Counter(str(slide.grade_group) for slide in slides).items())
        ),
    }
    catalog: dict[str, Any] = {
        "schema_version": "1.0.0",
        "dataset_id": manifest.dataset_id,
        "dataset_ref": "sicapv2:v2:dataset:10.17632/9xxm58dvs3.2",
        "archive_ref": ARCHIVE_REF,
        "archive_sha256": manifest.archive.sha256,
        "source_release": manifest.source_release,
        "rights": manifest.license.model_dump(mode="json"),
        "native_mask_labels": [label.model_dump() for label in manifest.native_mask_labels],
        "record_sets": {
            "patients": "outputs/patients.jsonl",
            "slides": "outputs/slides.jsonl",
            "patches": "outputs/patches.jsonl",
        },
        "table_artifacts": [artifact.model_dump() for artifact in table_artifacts],
    }
    output = root / "outputs"
    temporary = root / ".outputs.part"
    shutil.rmtree(temporary, ignore_errors=True)
    temporary.mkdir(parents=True)
    try:
        (temporary / "patients.jsonl").write_text(_json_lines(patients), encoding="utf-8")
        (temporary / "slides.jsonl").write_text(_json_lines(slides), encoding="utf-8")
        (temporary / "patches.jsonl").write_text(_json_lines(patches), encoding="utf-8")
        (temporary / "catalog.json").write_text(
            json.dumps(catalog, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        (temporary / "source-metrics.json").write_text(
            json.dumps(metrics, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        shutil.rmtree(output, ignore_errors=True)
        temporary.replace(output)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return metrics


def index_archive(root: Path = PROJECT_DIR) -> dict[str, object]:  # noqa: C901
    manifest = load_manifest(root)
    archive_path = root / "data/raw" / manifest.archive.filename
    verify_archive(archive_path, manifest)
    with zipfile.ZipFile(archive_path) as archive:
        all_infos = _safe_infos(archive)
        if len(all_infos) != manifest.expected.archive_member_count:
            raise SourceDataError(
                f"expected {manifest.expected.archive_member_count} archive members, "
                f"found {len(all_infos)}"
            )
        infos = {info.filename: info for info in all_infos if not info.is_dir()}
        image_infos = {
            PurePosixPath(name).name: info
            for name, info in infos.items()
            if PurePosixPath(name).parent == PurePosixPath("SICAPv2/images")
            and name.endswith(".jpg")
        }
        mask_infos = {
            PurePosixPath(name).name: info
            for name, info in infos.items()
            if PurePosixPath(name).parent == PurePosixPath("SICAPv2/masks")
            and name.endswith(".jpg")
        }
        if len(image_infos) != manifest.expected.image_count:
            raise SourceDataError(f"expected {manifest.expected.image_count} images")
        if len(mask_infos) != manifest.expected.mask_count or set(mask_infos) != set(image_infos):
            raise SourceDataError("SICAPv2 image and Gleason-pattern mask identities differ")
        slide_info = infos.get("SICAPv2/wsi_labels.xlsx")
        readme_info = infos.get("SICAPv2/readme.txt")
        if slide_info is None or readme_info is None:
            raise SourceDataError("SICAPv2 archive lacks source documentation or slide labels")
        source_readme = archive.read(readme_info).decode("utf-8-sig")
        if manifest.source_release not in source_readme:
            raise SourceDataError("SICAPv2 archive internal release differs from the manifest")
        slides_by_id, slide_table = _slide_rows(archive, slide_info)
        labels, roles, partition_artifacts = _partition_tables(archive, infos, manifest)
        unknown_role_images = set(roles) - set(image_infos)
        if unknown_role_images:
            raise SourceDataError(
                f"published roles reference {len(unknown_role_images)} missing patches"
            )
        patch_records: list[PatchRecord] = []
        patch_refs_by_slide: dict[str, list[str]] = defaultdict(list)
        for filename, image_info in sorted(image_infos.items()):
            slide_id, coordinates = parse_patch_name(filename)
            slide = slides_by_id.get(slide_id)
            if slide is None:
                raise SourceDataError(f"patch references missing slide identity: {filename}")
            patch_id = filename.removesuffix(".jpg")
            record_ref = f"sicapv2:v2:patch:{patch_id}"
            patch_records.append(
                PatchRecord(
                    record_ref=record_ref,
                    patch_id=patch_id,
                    slide_ref=slide.record_ref,
                    slide_id=slide_id,
                    patient_ref=slide.patient_ref,
                    coordinates=coordinates,
                    scale=manifest.scale,
                    image=_artifact(image_info),
                    gleason_pattern_mask=_artifact(mask_infos[filename]),
                    mask_label_ids=(0, 1, 2, 3),
                    published_labels=labels.get(filename),
                    published_roles=sorted(
                        roles.get(filename, []), key=lambda item: (item.partition_id, item.task)
                    ),
                )
            )
            patch_refs_by_slide[slide_id].append(record_ref)
        if len(patch_records) != manifest.expected.patch_count:
            raise SourceDataError(f"expected {manifest.expected.patch_count} source patches")
        slide_records = [
            slide.model_copy(update={"patch_refs": patch_refs_by_slide[slide.slide_id]})
            for slide in sorted(slides_by_id.values(), key=lambda item: item.slide_id)
        ]
        if len(slide_records) != manifest.expected.slide_count:
            raise SourceDataError(f"expected {manifest.expected.slide_count} source slides")
        slides_by_patient: dict[str, list[str]] = defaultdict(list)
        for slide in slide_records:
            slides_by_patient[slide.patient_id].append(slide.record_ref)
        patient_records = [
            PatientRecord(
                record_ref=f"sicapv2:v2:patient:{patient_id}",
                patient_id=patient_id,
                slide_refs=sorted(slide_refs),
            )
            for patient_id, slide_refs in sorted(slides_by_patient.items())
        ]
        if len(patient_records) != manifest.expected.patient_count:
            raise SourceDataError(f"expected {manifest.expected.patient_count} source patients")
        table_artifacts = [_artifact(readme_info), slide_table, *partition_artifacts]
    return _write_outputs(
        root,
        manifest,
        patient_records,
        slide_records,
        patch_records,
        table_artifacts,
    )
