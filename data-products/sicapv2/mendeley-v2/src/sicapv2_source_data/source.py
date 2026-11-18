from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import stat
import tempfile
import urllib.request
import zipfile
from collections import Counter, defaultdict
from collections.abc import Generator, Iterable
from contextlib import contextmanager
from fcntl import LOCK_EX, LOCK_UN, flock
from http.client import HTTPMessage
from pathlib import Path, PurePosixPath
from typing import IO, Literal, override
from urllib.parse import urlsplit

from openpyxl import load_workbook
from pydantic import BaseModel

from sicapv2_source_data.models import (
    CribriformTableRow,
    ExpectedPatchLabelCounts,
    GlobalGleasonScoreCounts,
    GradeGroupCounts,
    MendeleyMetadataResponse,
    OriginalArtifact,
    PatchCoordinates,
    PatchRecord,
    PatientRecord,
    PublishedCribriformLabel,
    PublishedPartition,
    PublishedPatchLabels,
    PublishedPatchTableRow,
    PublishedRole,
    PublishedRoleCounts,
    PublisherMetadataContract,
    PublisherMetadataEvidence,
    RecordSets,
    SlideRecord,
    SlideTableRow,
    SourceCatalog,
    SourceManifest,
    SourceMetrics,
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


def _write_text_atomically(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".part",
            delete=False,
        ) as stream:
            temporary = Path(stream.name)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


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


def verify_publisher_metadata(root: Path = PROJECT_DIR) -> PublisherMetadataEvidence:
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
    response = MendeleyMetadataResponse.model_validate(
        {
            "dataset": _json_request(dataset_url),
            "files": _json_request(files_url),
            "versions": _json_request(versions_url),
        }
    )
    actual = PublisherMetadataContract.from_response(response)
    expected = PublisherMetadataContract.from_manifest(manifest)
    if actual != expected:
        raise SourceDataError(
            "live Mendeley metadata differs from the pinned manifest: "
            f"expected {expected.model_dump_json()}, found {actual.model_dump_json()}"
        )
    result = PublisherMetadataEvidence.from_verified_contract(actual, manifest)
    output = root / "records/publisher-metadata.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.is_file():
        committed = PublisherMetadataEvidence.model_validate_json(
            output.read_text(encoding="utf-8")
        )
        if committed != result:
            raise SourceDataError(
                "committed publisher metadata differs from live Mendeley metadata"
            )
    else:
        _write_text_atomically(output, result.model_dump_json(indent=2) + "\n")
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
    request = urllib.request.Request(  # noqa: S310 - manifest constrains the URL to HTTPS.
        str(manifest.archive.url),
        headers={"User-Agent": "sicapv2-source-data/0.1 (+source-product)"},
    )
    opener = urllib.request.build_opener(_HttpsOnlyRedirectHandler())
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "wb",
            dir=destination.parent,
            prefix=f".{destination.name}.",
            suffix=".part",
            delete=False,
        ) as output:
            temporary = Path(output.name)
            with opener.open(request, timeout=60) as response:
                shutil.copyfileobj(response, output, length=1024 * 1024)
            output.flush()
            os.fsync(output.fileno())
        verify_archive(temporary, manifest)
        temporary.replace(destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
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


def _table_rows[RowT: BaseModel](
    archive: zipfile.ZipFile, path: str, row_type: type[RowT]
) -> list[RowT]:
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
        return [row_type.model_validate(dict(zip(names, row, strict=True))) for row in values]
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


def _partition_artifact(infos: dict[str, zipfile.ZipInfo], path: str) -> OriginalArtifact:
    info = infos.get(path)
    if info is None:
        raise SourceDataError(f"missing SICAPv2 partition artifact: {path}")
    return _artifact(info)


def _append_published_role(
    roles: dict[str, list[PublishedRole]],
    image_name: str,
    partition: PublishedPartition,
    task: Literal["gleason_grading", "cribriform_detection"],
    role: Literal["train", "test"],
    artifact: OriginalArtifact,
) -> None:
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
        raise SourceDataError(f"{image_name}: duplicate role in {partition.id} {task} tables")
    roles[image_name].append(published_role)


def _record_patch_labels(
    labels: dict[str, PublishedPatchLabels],
    image_name: str,
    patch_labels: PublishedPatchLabels,
) -> None:
    existing = labels.setdefault(image_name, patch_labels)
    if existing != patch_labels:
        raise SourceDataError(f"{image_name}: published labels differ across partitions")


def _record_cribriform_label(
    labels: dict[str, PublishedCribriformLabel],
    image_name: str,
    label: PublishedCribriformLabel,
) -> None:
    existing = labels.setdefault(image_name, label)
    if existing != label:
        raise SourceDataError(f"{image_name}: published cribriform labels differ across partitions")


def _read_partition_table(
    archive: zipfile.ZipFile,
    infos: dict[str, zipfile.ZipInfo],
    partition: PublishedPartition,
    role_name: Literal["Train", "Test"],
    task: Literal["gleason_grading", "cribriform_detection"],
    suffix: str,
    labels: dict[str, PublishedPatchLabels],
    cribriform_labels: dict[str, PublishedCribriformLabel],
    roles: dict[str, list[PublishedRole]],
) -> OriginalArtifact:
    role: Literal["train", "test"] = "train" if role_name == "Train" else "test"
    path = f"{partition.path}/{role_name}{suffix}.xlsx"
    artifact = _partition_artifact(infos, path)
    if task == "gleason_grading":
        for row in _table_rows(archive, path, PublishedPatchTableRow):
            _append_published_role(roles, row.image_name, partition, task, role, artifact)
            _record_patch_labels(labels, row.image_name, row.labels())
    else:
        for row in _table_rows(archive, path, CribriformTableRow):
            _append_published_role(roles, row.image_name, partition, task, role, artifact)
            _record_cribriform_label(cribriform_labels, row.image_name, row.label())
    return artifact


def _partition_tables(
    archive: zipfile.ZipFile,
    infos: dict[str, zipfile.ZipInfo],
    manifest: SourceManifest,
) -> tuple[
    dict[str, PublishedPatchLabels],
    dict[str, PublishedCribriformLabel],
    dict[str, list[PublishedRole]],
    list[OriginalArtifact],
]:
    labels: dict[str, PublishedPatchLabels] = {}
    cribriform_labels: dict[str, PublishedCribriformLabel] = {}
    roles: dict[str, list[PublishedRole]] = defaultdict(list)
    artifacts: list[OriginalArtifact] = []
    for partition in manifest.published_partitions:
        for role_name in ("Train", "Test"):
            for task, suffix in (("gleason_grading", ""), ("cribriform_detection", "Cribfriform")):
                artifacts.append(
                    _read_partition_table(
                        archive,
                        infos,
                        partition,
                        role_name,
                        task,
                        suffix,
                        labels,
                        cribriform_labels,
                        roles,
                    )
                )
    return labels, cribriform_labels, roles, artifacts


def _slide_rows(
    archive: zipfile.ZipFile, info: zipfile.ZipInfo
) -> tuple[dict[str, SlideRecord], OriginalArtifact]:
    path = info.filename
    artifact = _artifact(info)
    slides: dict[str, SlideRecord] = {}
    for row in _table_rows(archive, path, SlideTableRow):
        slide_id = row.slide_id
        patient_id = row.patient_identity
        primary = row.gleason_primary
        secondary = row.gleason_secondary
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
    return "".join(record.model_dump_json() + "\n" for record in records)


@contextmanager
def _output_lock(root: Path) -> Generator[None, None, None]:
    with (root / ".outputs.lock").open("a+b") as stream:
        flock(stream.fileno(), LOCK_EX)
        try:
            yield
        finally:
            flock(stream.fileno(), LOCK_UN)


def _publish_output_directory(root: Path, temporary: Path) -> None:
    output = root / "outputs"
    backup = Path(tempfile.mkdtemp(prefix=".outputs.backup.", dir=root))
    backup.rmdir()
    with _output_lock(root):
        had_output = output.exists()
        if had_output:
            output.replace(backup)
        try:
            temporary.replace(output)
        except BaseException:
            if output.exists():
                shutil.rmtree(output)
            if had_output and backup.exists():
                backup.replace(output)
            raise
        else:
            if backup.exists():
                shutil.rmtree(backup)


def _write_outputs(
    root: Path,
    manifest: SourceManifest,
    patients: list[PatientRecord],
    slides: list[SlideRecord],
    patches: list[PatchRecord],
    table_artifacts: list[OriginalArtifact],
) -> SourceMetrics:
    role_counts = Counter(
        f"{role.partition_id}:{role.task}:{role.role}"
        for patch in patches
        for role in patch.published_roles
    )
    label_counts: Counter[str] = Counter(dict.fromkeys(manifest.published_patch_labels, 0))
    for patch in patches:
        if patch.published_labels is None:
            continue
        for name, value in patch.published_labels:
            label_counts[name] += value
    labelled_patch_count = sum(patch.published_labels is not None for patch in patches)
    if labelled_patch_count != manifest.expected.published_labelled_patch_count:
        raise SourceDataError("SICAPv2 published labelled-patch count differs from the manifest")
    actual_label_counts = ExpectedPatchLabelCounts.model_validate(dict(label_counts))
    if actual_label_counts != manifest.expected.published_patch_label_counts:
        raise SourceDataError("SICAPv2 published patch-label counts differ from the manifest")
    metrics = SourceMetrics(
        dataset_id=manifest.dataset_id,
        patient_count=len(patients),
        slide_count=len(slides),
        patch_count=len(patches),
        paired_mask_count=len(patches),
        published_labelled_patch_count=labelled_patch_count,
        published_patch_label_counts=actual_label_counts,
        published_role_counts=PublishedRoleCounts.model_validate(dict(role_counts)),
        global_gleason_score_counts=GlobalGleasonScoreCounts.model_validate(
            dict(Counter(slide.global_gleason_score for slide in slides))
        ),
        grade_group_counts=GradeGroupCounts.model_validate(
            dict(Counter(str(slide.grade_group) for slide in slides))
        ),
    )
    catalog = SourceCatalog(
        dataset_id=manifest.dataset_id,
        dataset_ref="sicapv2:v2:dataset:10.17632/9xxm58dvs3.2",
        archive_ref=ARCHIVE_REF,
        archive_sha256=manifest.archive.sha256,
        source_release=manifest.source_release,
        rights=manifest.license,
        native_mask_labels=manifest.native_mask_labels,
        record_sets=RecordSets(),
        table_artifacts=table_artifacts,
    )
    temporary = Path(tempfile.mkdtemp(prefix=".outputs.staging.", dir=root))
    try:
        (temporary / "patients.jsonl").write_text(_json_lines(patients), encoding="utf-8")
        (temporary / "slides.jsonl").write_text(_json_lines(slides), encoding="utf-8")
        (temporary / "patches.jsonl").write_text(_json_lines(patches), encoding="utf-8")
        (temporary / "catalog.json").write_text(
            catalog.model_dump_json(indent=2) + "\n", encoding="utf-8"
        )
        (temporary / "source-metrics.json").write_text(
            metrics.model_dump_json(indent=2) + "\n", encoding="utf-8"
        )
        _publish_output_directory(root, temporary)
    finally:
        shutil.rmtree(temporary, ignore_errors=True)
    return metrics


def _image_and_mask_infos(
    infos: dict[str, zipfile.ZipInfo], manifest: SourceManifest
) -> tuple[dict[str, zipfile.ZipInfo], dict[str, zipfile.ZipInfo]]:
    image_infos = {
        PurePosixPath(name).name: info
        for name, info in infos.items()
        if PurePosixPath(name).parent == PurePosixPath("SICAPv2/images") and name.endswith(".jpg")
    }
    mask_infos = {
        PurePosixPath(name).name: info
        for name, info in infos.items()
        if PurePosixPath(name).parent == PurePosixPath("SICAPv2/masks") and name.endswith(".jpg")
    }
    if len(image_infos) != manifest.expected.image_count:
        raise SourceDataError(f"expected {manifest.expected.image_count} images")
    if len(mask_infos) != manifest.expected.mask_count or set(mask_infos) != set(image_infos):
        raise SourceDataError("SICAPv2 image and Gleason-pattern mask identities differ")
    return image_infos, mask_infos


def _source_table_infos(
    archive: zipfile.ZipFile,
    infos: dict[str, zipfile.ZipInfo],
    manifest: SourceManifest,
) -> tuple[zipfile.ZipInfo, zipfile.ZipInfo]:
    slide_info = infos.get("SICAPv2/wsi_labels.xlsx")
    readme_info = infos.get("SICAPv2/readme.txt")
    if slide_info is None or readme_info is None:
        raise SourceDataError("SICAPv2 archive lacks source documentation or slide labels")
    source_readme = archive.read(readme_info).decode("utf-8-sig")
    if manifest.source_release not in source_readme:
        raise SourceDataError("SICAPv2 archive internal release differs from the manifest")
    return slide_info, readme_info


def _patch_records(
    image_infos: dict[str, zipfile.ZipInfo],
    mask_infos: dict[str, zipfile.ZipInfo],
    slides_by_id: dict[str, SlideRecord],
    labels: dict[str, PublishedPatchLabels],
    cribriform_labels: dict[str, PublishedCribriformLabel],
    roles: dict[str, list[PublishedRole]],
    manifest: SourceManifest,
) -> tuple[list[PatchRecord], dict[str, list[str]]]:
    records: list[PatchRecord] = []
    refs_by_slide: dict[str, list[str]] = defaultdict(list)
    for filename, image_info in sorted(image_infos.items()):
        slide_id, coordinates = parse_patch_name(filename)
        slide = slides_by_id.get(slide_id)
        if slide is None:
            raise SourceDataError(f"patch references missing slide identity: {filename}")
        patch_id = filename.removesuffix(".jpg")
        record_ref = f"sicapv2:v2:patch:{patch_id}"
        published_labels = labels.get(filename)
        published_cribriform_label = cribriform_labels.get(filename)
        if (
            published_labels is not None
            and published_cribriform_label is not None
            and published_labels.G4C != published_cribriform_label.G4C
        ):
            raise SourceDataError(
                f"{filename}: published G4C values differ between grading and cribriform tables"
            )
        records.append(
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
                published_labels=published_labels,
                published_cribriform_label=published_cribriform_label,
                published_roles=sorted(
                    roles.get(filename, []), key=lambda item: (item.partition_id, item.task)
                ),
            )
        )
        refs_by_slide[slide_id].append(record_ref)
    if len(records) != manifest.expected.patch_count:
        raise SourceDataError(f"expected {manifest.expected.patch_count} source patches")
    return records, refs_by_slide


def _slide_and_patient_records(
    slides_by_id: dict[str, SlideRecord],
    patch_refs_by_slide: dict[str, list[str]],
    manifest: SourceManifest,
) -> tuple[list[SlideRecord], list[PatientRecord]]:
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
    return slide_records, patient_records


def index_archive(root: Path = PROJECT_DIR) -> SourceMetrics:
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
        image_infos, mask_infos = _image_and_mask_infos(infos, manifest)
        slide_info, readme_info = _source_table_infos(archive, infos, manifest)
        slides_by_id, slide_table = _slide_rows(archive, slide_info)
        labels, cribriform_labels, roles, partition_artifacts = _partition_tables(
            archive, infos, manifest
        )
        unknown_role_images = set(roles) - set(image_infos)
        if unknown_role_images:
            raise SourceDataError(
                f"published roles reference {len(unknown_role_images)} missing patches"
            )
        patch_records, patch_refs_by_slide = _patch_records(
            image_infos,
            mask_infos,
            slides_by_id,
            labels,
            cribriform_labels,
            roles,
            manifest,
        )
        slide_records, patient_records = _slide_and_patient_records(
            slides_by_id, patch_refs_by_slide, manifest
        )
        table_artifacts = [_artifact(readme_info), slide_table, *partition_artifacts]
    return _write_outputs(
        root,
        manifest,
        patient_records,
        slide_records,
        patch_records,
        table_artifacts,
    )
