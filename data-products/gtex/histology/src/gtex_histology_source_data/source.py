from __future__ import annotations

import hashlib
import json
import os
import shutil
import urllib.request
from collections.abc import Callable, Iterable
from http.client import HTTPMessage
from pathlib import Path
from typing import IO, Any, override
from urllib.parse import urlencode, urlsplit

from gtex_histology_source_data.models import (
    AcquisitionEvidence,
    AcquisitionFile,
    Artifact,
    Snapshot,
    SourceManifest,
)

PROJECT_DIR = Path(__file__).resolve().parents[2]
USER_AGENT = "gtex-histology-source-data/0.1 (+metadata-only)"
PAGE_SIZE = 10_000


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


def _opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(_HttpsOnlyRedirectHandler())


def _require_https(url: str) -> None:
    if urlsplit(url).scheme.lower() != "https":
        raise SourceDataError(f"publisher URL must use HTTPS: {url}")


def _request_json(url: str, payload: dict[str, object] | None = None) -> dict[str, Any]:
    _require_https(url)
    data = None if payload is None else json.dumps(payload).encode()
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers)  # noqa: S310
    with _opener().open(request, timeout=90) as response:
        result = json.load(response)
    if not isinstance(result, dict):
        raise SourceDataError(f"publisher returned a non-object response: {url}")
    return result


def _digest(path: Path, algorithm: str = "sha256") -> str:
    result = hashlib.new(algorithm)
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def _download(artifact: Artifact, destination: Path) -> None:
    _require_https(str(artifact.url))
    request = urllib.request.Request(  # noqa: S310 - Pydantic requires HTTPS.
        str(artifact.url), headers={"User-Agent": USER_AGENT}
    )
    temporary = destination.with_suffix(destination.suffix + ".part")
    temporary.unlink(missing_ok=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with _opener().open(request, timeout=90) as response, temporary.open("wb") as target:
            shutil.copyfileobj(response, target, length=1024 * 1024)
            target.flush()
            os.fsync(target.fileno())
        _verify_download(temporary, artifact)
        temporary.replace(destination)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def _verify_download(path: Path, artifact: Artifact) -> None:
    if path.stat().st_size != artifact.bytes:
        raise SourceDataError(f"downloaded byte count differs for {artifact.name}")
    if _digest(path, "md5") != artifact.md5:
        raise SourceDataError(f"downloaded MD5 differs for {artifact.name}")
    if _digest(path) != artifact.sha256:
        raise SourceDataError(f"downloaded SHA-256 differs for {artifact.name}")


def _canonical_line(record: dict[str, Any]) -> str:
    return json.dumps(record, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"


def _write_snapshot(
    destination: Path,
    records: Iterable[dict[str, Any]],
    snapshot: Snapshot,
) -> AcquisitionFile:
    count = 0
    with destination.open("w", encoding="utf-8", newline="\n") as output:
        for record in records:
            output.write(_canonical_line(record))
            count += 1
    if count != snapshot.expected_records:
        raise SourceDataError(
            f"{snapshot.name} returned {count} records, expected {snapshot.expected_records}"
        )
    digest = _digest(destination)
    if digest != snapshot.canonical_sha256:
        raise SourceDataError(
            f"{snapshot.name} canonical SHA-256 changed: {digest}; "
            f"pinned {snapshot.canonical_sha256}"
        )
    return AcquisitionFile(
        name=destination.name,
        records=count,
        bytes=destination.stat().st_size,
        sha256=digest,
    )


def _snapshots(manifest: SourceManifest) -> dict[str, Snapshot]:
    return {snapshot.name: snapshot for snapshot in manifest.snapshots}


def _gtex_histology(snapshot: Snapshot) -> list[dict[str, Any]]:
    query = urlencode({"page": 0, "itemsPerPage": snapshot.expected_records})
    payload = _request_json(f"{snapshot.endpoint}?{query}")
    paging = payload.get("paging_info")
    records = payload.get("data")
    if not isinstance(paging, dict) or not isinstance(records, list):
        raise SourceDataError("GTEx histology response lacks paging_info or data")
    if paging.get("totalNumberOfItems") != snapshot.expected_records:
        raise SourceDataError("GTEx histology total changed")
    return sorted(records, key=lambda row: str(row["histologyImageId"]))


def _anvil_svs(snapshot: Snapshot) -> list[dict[str, Any]]:
    filters = {
        "datasets.title": {"is": ["ANVIL_GTEx_public_data"]},
        "files.file_format": {"is": [".svs"]},
    }
    query = urlencode({"filters": json.dumps(filters), "size": 1000})
    url: str | None = f"{snapshot.endpoint}?{query}"
    records: list[dict[str, Any]] = []
    while url is not None:
        payload = _request_json(url)
        pagination = payload.get("pagination")
        hits = payload.get("hits")
        if not isinstance(pagination, dict) or not isinstance(hits, list):
            raise SourceDataError("AnVIL response lacks pagination or hits")
        if pagination.get("total") != snapshot.expected_records:
            raise SourceDataError("AnVIL SVS total changed")
        for hit in hits:
            files = hit.get("files", [])
            sources = hit.get("sources", [])
            datasets = hit.get("datasets", [])
            if len(files) != 1 or len(sources) != 1 or len(datasets) != 1:
                raise SourceDataError("AnVIL SVS hit does not have one file, source, and dataset")
            file = files[0]
            source = sources[0]
            dataset = datasets[0]
            records.append(
                {
                    "accessible": file["accessible"],
                    "azul_mirror_uri": file["azul_mirror_uri"],
                    "azul_url": file["azul_url"],
                    "consent_group": dataset["consent_group"][0],
                    "dataset_id": dataset["dataset_id"][0],
                    "dataset_title": dataset["title"][0],
                    "document_id": file["document_id"],
                    "drs_uri": file["drs_uri"],
                    "file_format": file["file_format"],
                    "file_id": file["file_id"],
                    "file_md5sum": file["file_md5sum"],
                    "file_name": file["file_name"],
                    "file_path": file["file_path"],
                    "file_size": file["file_size"],
                    "is_supplementary": file["is_supplementary"],
                    "source_id": source["source_id"],
                    "source_spec": source["source_spec"],
                }
            )
        next_url = pagination.get("next")
        url = str(next_url) if next_url is not None else None
    return sorted(records, key=lambda row: str(row["file_id"]))


def _idc_rows(snapshot: Snapshot, columns: str, joins: str, order: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for offset in range(0, snapshot.expected_records, PAGE_SIZE):
        sql = (
            f"SELECT {columns} FROM {joins} "  # noqa: S608 - internal query fragments.
            "WHERE i.collection_id = ? AND i.analysis_result_id IS NULL "
            f"ORDER BY {order} LIMIT {PAGE_SIZE} OFFSET {offset}"
        )
        payload = _request_json(
            str(snapshot.endpoint), {"sql": sql, "params": ["gtex"], "max_rows": PAGE_SIZE}
        )
        rows = payload.get("rows")
        if not isinstance(rows, list) or payload.get("truncated") is not False:
            raise SourceDataError(f"IDC query for {snapshot.name} was truncated or invalid")
        records.extend(rows)
    if len(records) != snapshot.expected_records:
        raise SourceDataError(f"IDC query for {snapshot.name} returned {len(records)} rows")
    return records


def _idc_series(snapshot: Snapshot) -> list[dict[str, Any]]:
    columns = ", ".join(
        [
            "i.PatientID",
            "i.StudyInstanceUID",
            "i.SeriesInstanceUID",
            "sm.ContainerIdentifier",
            "i.crdc_series_uuid",
            "i.instanceCount",
            "i.series_size_MB",
            "i.series_aws_url",
            "i.source_DOI",
            "i.license_short_name",
            "i.series_init_idc_version",
            "i.series_revised_idc_version",
            "i.Manufacturer",
            "i.ManufacturerModelName",
            "i.SeriesDescription",
            "sm.embeddingMedium_CodeMeaning",
            "sm.tissueFixative_CodeMeaning",
            "sm.staining_usingSubstance_CodeMeaning",
            "sm.primaryAnatomicStructure_CodeMeaning",
        ]
    )
    return _idc_rows(
        snapshot,
        columns,
        "sm_index sm JOIN index i USING (SeriesInstanceUID)",
        "i.SeriesInstanceUID",
    )


def _idc_instances(snapshot: Snapshot) -> list[dict[str, Any]]:
    columns = ", ".join(
        [
            "sm.SOPInstanceUID",
            "sm.SeriesInstanceUID",
            "sm.crdc_instance_uuid",
            "sm.instance_size",
            "sm.embeddingMedium_CodeMeaning",
            "sm.tissueFixative_CodeMeaning",
            "sm.staining_usingSubstance_CodeMeaning",
        ]
    )
    return _idc_rows(
        snapshot,
        columns,
        "sm_instance_index sm JOIN index i USING (SeriesInstanceUID)",
        "sm.SeriesInstanceUID, sm.SOPInstanceUID",
    )


def _file_evidence(path: Path, records: int | None = None) -> AcquisitionFile:
    return AcquisitionFile(
        name=path.name,
        records=records,
        bytes=path.stat().st_size,
        sha256=_digest(path),
    )


def _validate_existing(root: Path, evidence: AcquisitionEvidence) -> None:
    for item in evidence.files:
        candidates = [root / item.name, root / "static" / item.name]
        path = next((candidate for candidate in candidates if candidate.is_file()), None)
        if path is None or path.is_symlink() or _digest(path) != item.sha256:
            raise SourceDataError(f"existing acquisition is incomplete or changed: {item.name}")


def acquire_metadata(root: Path = PROJECT_DIR) -> AcquisitionEvidence:
    manifest = load_manifest(root)
    output = root / "data/raw"
    evidence_path = output / "acquisition.json"
    if output.exists():
        if not evidence_path.is_file():
            raise SourceDataError(f"incomplete acquisition output: {output}")
        evidence = AcquisitionEvidence.model_validate_json(
            evidence_path.read_text(encoding="utf-8")
        )
        _validate_existing(output, evidence)
        return evidence

    temporary = root / "data/.raw.part"
    shutil.rmtree(temporary, ignore_errors=True)
    temporary.mkdir(parents=True)
    complete = False
    try:
        files: list[AcquisitionFile] = []
        for artifact in manifest.static_artifacts:
            destination = temporary / "static" / artifact.name
            _download(artifact, destination)
            files.append(_file_evidence(destination))

        snapshots = _snapshots(manifest)
        snapshot_jobs: list[tuple[str, Callable[[Snapshot], list[dict[str, Any]]], str]] = [
            ("gtex_histology_api", _gtex_histology, "gtex-histology-api.jsonl"),
            ("anvil_svs", _anvil_svs, "anvil-svs.jsonl"),
            ("idc_series", _idc_series, "idc-series.jsonl"),
            ("idc_instances", _idc_instances, "idc-instances.jsonl"),
        ]
        for name, fetch, filename in snapshot_jobs:
            snapshot = snapshots[name]
            files.append(_write_snapshot(temporary / filename, fetch(snapshot), snapshot))

        evidence = AcquisitionEvidence(dataset_id=manifest.dataset_id, files=files)
        (temporary / "acquisition.json").write_text(
            evidence.model_dump_json(indent=2) + "\n", encoding="utf-8"
        )
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary.replace(output)
        complete = True
        return evidence
    finally:
        if not complete:
            shutil.rmtree(temporary, ignore_errors=True)


def verify_live_identities(root: Path = PROJECT_DIR) -> dict[str, object]:
    manifest = load_manifest(root)
    snapshots = _snapshots(manifest)
    gtex = _request_json(
        f"{snapshots['gtex_histology_api'].endpoint}?{urlencode({'page': 0, 'itemsPerPage': 1})}"
    )
    idc_version = _request_json("https://api.imaging.datacommons.cancer.gov/v3/version")
    idc_collection = _request_json("https://api.imaging.datacommons.cancer.gov/v3/collections/gtex")
    filters = {
        "datasets.title": {"is": ["ANVIL_GTEx_public_data"]},
        "files.file_format": {"is": [".svs"]},
    }
    anvil = _request_json(
        f"{snapshots['anvil_svs'].endpoint}?"
        f"{urlencode({'filters': json.dumps(filters), 'size': 1})}"
    )
    zenodo = _request_json("https://zenodo.org/api/records/11099099")
    legacy = urllib.request.Request(
        "https://brd.nci.nih.gov/brd/image-search/search_specimen",
        method="HEAD",
        headers={"User-Agent": USER_AGENT},
    )
    with _opener().open(legacy, timeout=30) as response:
        brd = {"final_url": response.geturl(), "status": response.status}
    result = {
        "gtex_histology_records": gtex["paging_info"]["totalNumberOfItems"],
        "idc_version": idc_version["idc_version"],
        "idc_index_data_version": idc_version["idc_index_data_version"],
        "idc_series": idc_collection["series"],
        "idc_instances": idc_collection["instances"],
        "anvil_svs_files": anvil["pagination"]["total"],
        "anvil_source_spec": anvil["hits"][0]["sources"][0]["source_spec"],
        "zenodo_record": zenodo["id"],
        "zenodo_concept_doi": zenodo["conceptdoi"],
        "brd_legacy": brd,
    }
    expected = {
        "gtex_histology_records": 25713,
        "idc_version": "v25",
        "idc_index_data_version": "25.0.5",
        "idc_series": 25503,
        "idc_instances": 128708,
        "anvil_svs_files": 25708,
        "zenodo_record": 11099100,
        "zenodo_concept_doi": "10.5281/zenodo.11099099",
    }
    for key, value in expected.items():
        if result[key] != value:
            raise SourceDataError(f"live identity changed for {key}: {result[key]!r}")
    return result
