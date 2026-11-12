from __future__ import annotations

import csv
import hashlib
import io
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from cptac_lscc_source.models import NativeRecord, PdcVersion, SnapshotFile, SnapshotManifest

PROJECT_DIR = Path(__file__).resolve().parents[2]
TCIA_COLLECTION_URL = "https://www.cancerimagingarchive.net/api/v1/collections/45043"
TCIA_PATHOLOGY_DOWNLOAD_URL = "https://www.cancerimagingarchive.net/api/v1/downloads/44937"
TCIA_METADATA_URL = (
    "https://pathdb.cancerimagingarchive.net/system/files/collectionmetadata/202407/"
    "cptac_metadata_07-09-2024.csv"
)
PDC_GRAPHQL_URL = "https://pdc.cancer.gov/graphql/"
GDC_API_URL = "https://api.gdc.cancer.gov"
ALLOWED_HOSTS = {
    "www.cancerimagingarchive.net",
    "pathdb.cancerimagingarchive.net",
    "pdc.cancer.gov",
    "api.gdc.cancer.gov",
}


class AcquisitionError(RuntimeError):
    pass


def _request(url: str, *, payload: dict[str, Any] | None = None) -> bytes:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
        raise AcquisitionError(f"metadata URL is not allowlisted: {url}")
    body = json.dumps(payload).encode() if payload is not None else None
    request = Request(  # noqa: S310 - exact HTTPS hosts are allowlisted above.
        url,
        data=body,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "cptac-lscc-source-data/0.1 (+metadata-only)",
        },
        method="POST" if body is not None else "GET",
    )
    with urlopen(request, timeout=120) as response:  # noqa: S310
        return response.read()


def _json_request(url: str, *, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    value = json.loads(_request(url, payload=payload))
    if not isinstance(value, dict):
        raise AcquisitionError(f"metadata endpoint did not return an object: {url}")
    return cast(dict[str, Any], value)


def _graphql(query: str) -> dict[str, Any]:
    response = _json_request(PDC_GRAPHQL_URL, payload={"query": query})
    if response.get("errors"):
        raise AcquisitionError(f"PDC GraphQL query failed: {response['errors']}")
    data = response.get("data")
    if not isinstance(data, dict):
        raise AcquisitionError("PDC GraphQL response has no data object")
    return cast(dict[str, Any], data)


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _write_jsonl(path: Path, values: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(value, sort_keys=True) + "\n" for value in values),
        encoding="utf-8",
    )


def _native(repository: str, native_id: str, value: dict[str, Any]) -> dict[str, Any]:
    return NativeRecord.model_validate(
        {"repository": repository, "native_id": native_id, "native": value}
    ).model_dump(mode="json")


def _tcia_snapshots() -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    collection = _json_request(TCIA_COLLECTION_URL)
    pathology_download = _json_request(TCIA_PATHOLOGY_DOWNLOAD_URL)
    rows = list(csv.DictReader(io.StringIO(_request(TCIA_METADATA_URL).decode("utf-8-sig"))))
    slides = [row for row in rows if row.get("Tumor") == "LSCC"]
    if collection.get("collection_short_title") != "CPTAC-LSCC":
        raise AcquisitionError("TCIA collection identity changed")
    if str(collection.get("version_number")) != "15":
        raise AcquisitionError("TCIA CPTAC-LSCC release is no longer version 15")
    if pathology_download.get("download_type") != "Pathology Images":
        raise AcquisitionError("TCIA pathology download identity changed")
    if len(slides) != 1081 or len({row["Case_ID"] for row in slides}) != 212:
        raise AcquisitionError("TCIA CPTAC-LSCC metadata no longer has 1,081 slides and 212 cases")
    return (
        collection,
        pathology_download,
        [
            _native("TCIA", row["Slide_ID"], row)
            for row in sorted(slides, key=lambda item: item["Slide_ID"])
        ],
    )


def _pdc_catalog(study_ids: list[str]) -> tuple[list[PdcVersion], dict[str, str]]:
    data = _graphql(
        "{ studyCatalog { pdc_study_id versions { study_id study_submitter_id "
        "submitter_id_name study_shortname study_version is_latest_version } } }"
    )
    entries = data.get("studyCatalog")
    if not isinstance(entries, list):
        raise AcquisitionError("PDC study catalog is missing")
    versions: list[PdcVersion] = []
    study_uuid_by_pdc_id: dict[str, str] = {}
    by_id = {entry["pdc_study_id"]: entry for entry in entries if isinstance(entry, dict)}
    for pdc_study_id in study_ids:
        entry = by_id.get(pdc_study_id)
        if not isinstance(entry, dict):
            raise AcquisitionError(f"PDC catalog is missing {pdc_study_id}")
        latest = [
            item
            for item in entry.get("versions", [])
            if isinstance(item, dict) and item.get("is_latest_version") == "yes"
        ]
        if len(latest) != 1:
            raise AcquisitionError(f"PDC catalog has no unique latest version for {pdc_study_id}")
        item = latest[0]
        version = PdcVersion(
            pdc_study_id=pdc_study_id,
            study_id=str(item["study_id"]),
            study_version=str(item["study_version"]),
            is_latest_version=str(item["is_latest_version"]),
        )
        versions.append(version)
        study_uuid_by_pdc_id[pdc_study_id] = version.study_id
    return versions, study_uuid_by_pdc_id


def _pdc_snapshots(
    study_ids: list[str],
) -> tuple[
    list[PdcVersion],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    versions, study_uuid_by_pdc_id = _pdc_catalog(study_ids)
    studies: list[dict[str, Any]] = []
    biospecimens: list[dict[str, Any]] = []
    clinical: list[dict[str, Any]] = []
    files: list[dict[str, Any]] = []
    for pdc_study_id in study_ids:
        study_data = _graphql(
            '{ study(pdc_study_id: "'
            + pdc_study_id
            + '", acceptDUA: true) { study_id pdc_study_id study_submitter_id study_name '
            "study_description program_name project_name disease_type primary_site "
            "analytical_fraction experiment_type cases_count aliquots_count "
            "filesCount { data_category file_type files_count } } }"
        ).get("study")
        if not isinstance(study_data, list) or len(study_data) != 1:
            raise AcquisitionError(f"PDC study query did not return one record for {pdc_study_id}")
        study = cast(dict[str, Any], study_data[0])
        studies.append(_native("PDC", str(study["study_id"]), study))

        biospecimen_data = _graphql(
            '{ biospecimenPerStudy(pdc_study_id: "'
            + pdc_study_id
            + '", acceptDUA: true) { aliquot_id aliquot_submitter_id sample_id '
            "sample_submitter_id case_id case_submitter_id aliquot_status case_status "
            "sample_status project_name sample_type disease_type primary_site pool taxon "
            "externalReferences { external_reference_id reference_resource_shortname "
            "reference_resource_name reference_entity_location } } }"
        ).get("biospecimenPerStudy")
        if not isinstance(biospecimen_data, list):
            raise AcquisitionError(f"PDC biospecimen query failed for {pdc_study_id}")
        for item in biospecimen_data:
            value = cast(dict[str, Any], item)
            value["pdc_study_id"] = pdc_study_id
            value["study_id"] = study_uuid_by_pdc_id[pdc_study_id]
            native_id = f"{pdc_study_id}:{value['aliquot_id']}"
            biospecimens.append(_native("PDC", native_id, value))

        clinical_data = _graphql(
            '{ clinicalPerStudy(pdc_study_id: "'
            + pdc_study_id
            + '", acceptDUA: true) { case_id case_submitter_id status disease_type '
            "primary_site consent_type ethnicity gender race cause_of_death days_to_birth "
            "days_to_death year_of_birth year_of_death age_at_index morphology "
            "primary_diagnosis site_of_resection_or_biopsy tissue_or_organ_of_origin "
            "tumor_grade tumor_stage icd_10_code } }"
        ).get("clinicalPerStudy")
        if not isinstance(clinical_data, list):
            raise AcquisitionError(f"PDC clinical query failed for {pdc_study_id}")
        for item in clinical_data:
            value = cast(dict[str, Any], item)
            value["pdc_study_id"] = pdc_study_id
            value["study_id"] = study_uuid_by_pdc_id[pdc_study_id]
            native_id = f"{pdc_study_id}:{value['case_id']}"
            clinical.append(_native("PDC", native_id, value))

        file_data = _graphql(
            '{ filesPerStudy(study_id: "'
            + study_uuid_by_pdc_id[pdc_study_id]
            + '", offset: 0, limit: 10000) { study_id pdc_study_id study_submitter_id '
            "study_name file_id file_name file_submitter_id file_type md5sum file_location "
            "file_size data_category file_format } }"
        ).get("filesPerStudy")
        if not isinstance(file_data, list):
            raise AcquisitionError(f"PDC file query failed for {pdc_study_id}")
        expected_files = sum(int(item["files_count"]) for item in study.get("filesCount", []))
        if len(file_data) != expected_files:
            raise AcquisitionError(
                f"PDC file query returned {len(file_data)} of {expected_files} files "
                f"for {pdc_study_id}"
            )
        files.extend(
            _native("PDC", str(cast(dict[str, Any], item)["file_id"]), cast(dict[str, Any], item))
            for item in file_data
        )
    return (
        versions,
        sorted(studies, key=lambda item: item["native_id"]),
        sorted(biospecimens, key=lambda item: item["native_id"]),
        sorted(clinical, key=lambda item: item["native_id"]),
        sorted(files, key=lambda item: item["native_id"]),
    )


def _gdc_page(
    endpoint: str, filters: dict[str, Any], fields: str, expand: str
) -> list[dict[str, Any]]:
    values: list[dict[str, Any]] = []
    offset = 0
    page_size = 2000
    while True:
        payload = {
            "filters": filters,
            "format": "JSON",
            "fields": fields,
            "expand": expand,
            "from": offset,
            "size": page_size,
            "sort": "file_id:asc" if endpoint == "files" else "case_id:asc",
        }
        response = _json_request(f"{GDC_API_URL}/{endpoint}", payload=payload)
        data = response.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("hits"), list):
            raise AcquisitionError(f"GDC {endpoint} response has no hits")
        hits = cast(list[dict[str, Any]], data["hits"])
        values.extend(hits)
        pagination = data.get("pagination")
        if not isinstance(pagination, dict):
            raise AcquisitionError(f"GDC {endpoint} response has no pagination")
        total = int(pagination["total"])
        offset += len(hits)
        if offset >= total:
            return values
        if not hits:
            raise AcquisitionError(f"GDC {endpoint} pagination stopped before {total} records")


def _gdc_snapshots(
    case_ids: list[str],
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    status = _json_request(f"{GDC_API_URL}/status")
    filters = {
        "op": "and",
        "content": [
            {"op": "=", "content": {"field": "project.project_id", "value": "CPTAC-3"}},
            {"op": "in", "content": {"field": "submitter_id", "value": case_ids}},
        ],
    }
    cases = _gdc_page(
        "cases",
        filters,
        "case_id,submitter_id,project.project_id,primary_site,disease_type",
        "samples,samples.portions,samples.portions.analytes,samples.portions.analytes.aliquots",
    )
    file_filters = {
        "op": "and",
        "content": [
            {"op": "=", "content": {"field": "cases.project.project_id", "value": "CPTAC-3"}},
            {"op": "in", "content": {"field": "cases.submitter_id", "value": case_ids}},
        ],
    }
    files = _gdc_page(
        "files",
        file_filters,
        (
            "file_id,submitter_id,file_name,file_size,md5sum,access,acl,data_category,"
            "data_type,data_format,experimental_strategy,platform,state,data_release,revision,"
            "created_datetime,updated_datetime,analysis.workflow_type"
        ),
        "cases,cases.samples",
    )
    return (
        status,
        [_native("GDC", str(item["case_id"]), item) for item in cases],
        [_native("GDC", str(item["file_id"]), item) for item in files],
    )


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _snapshot_file(path: Path, root: Path, records: int) -> SnapshotFile:
    return SnapshotFile(path=str(path.relative_to(root)), sha256=_sha256(path), records=records)


def refresh_snapshots(root: Path = PROJECT_DIR) -> SnapshotManifest:
    contract = json.loads((root / "contracts/sources.json").read_text(encoding="utf-8"))
    study_ids = cast(list[str], contract["pdc_study_ids"])
    snapshots = root / "snapshots"
    collection, pathology_download, tcia_slides = _tcia_snapshots()
    pdc_versions, pdc_studies, pdc_biospecimens, pdc_clinical, pdc_files = _pdc_snapshots(study_ids)
    case_ids = sorted({str(item["native"]["Case_ID"]) for item in tcia_slides})
    gdc_status, gdc_cases, gdc_files = _gdc_snapshots(case_ids)

    written: list[tuple[Path, int]] = []
    for name, value in (
        (
            "tcia-collection.json",
            {"collection": collection, "pathology_download": pathology_download},
        ),
        ("gdc-status.json", gdc_status),
    ):
        path = snapshots / name
        _write_json(path, value)
        written.append((path, 1))
    for name, values in (
        ("tcia-slides.jsonl", tcia_slides),
        ("pdc-studies.jsonl", pdc_studies),
        ("pdc-biospecimens.jsonl", pdc_biospecimens),
        ("pdc-clinical.jsonl", pdc_clinical),
        ("pdc-files.jsonl", pdc_files),
        ("gdc-cases.jsonl", gdc_cases),
        ("gdc-files.jsonl", gdc_files),
    ):
        path = snapshots / name
        _write_jsonl(path, values)
        written.append((path, len(values)))

    gdc_version = gdc_status.get("data_release_version", {})
    manifest = SnapshotManifest(
        schema_version="1.0.0",
        product_id=str(contract["product_id"]),
        retrieved_at=datetime.now(UTC).replace(microsecond=0).isoformat(),
        tcia_collection_version=str(collection["version_number"]),
        tcia_collection_modified_gmt=str(collection["modified_gmt"]),
        pdc_versions=pdc_versions,
        gdc_data_release=str(gdc_status["data_release"]),
        gdc_data_release_version=f"{gdc_version['major']}.{gdc_version['minor']}",
        files=[_snapshot_file(path, root, records) for path, records in written],
    )
    _write_json(snapshots / "snapshot-manifest.json", manifest.model_dump(mode="json"))
    return manifest


def verify_live_releases(root: Path = PROJECT_DIR) -> dict[str, str]:
    manifest = SnapshotManifest.model_validate_json(
        (root / "snapshots/snapshot-manifest.json").read_text(encoding="utf-8")
    )
    contract = json.loads((root / "contracts/sources.json").read_text(encoding="utf-8"))
    collection = _json_request(TCIA_COLLECTION_URL)
    pdc_versions, _ = _pdc_catalog(cast(list[str], contract["pdc_study_ids"]))
    gdc_status = _json_request(f"{GDC_API_URL}/status")
    live_versions = {
        item.pdc_study_id: (item.study_id, item.study_version) for item in pdc_versions
    }
    pinned_versions = {
        item.pdc_study_id: (item.study_id, item.study_version) for item in manifest.pdc_versions
    }
    differences: list[str] = []
    if str(collection.get("version_number")) != manifest.tcia_collection_version:
        differences.append("TCIA collection version")
    if live_versions != pinned_versions:
        differences.append("PDC study versions")
    live_gdc_version = gdc_status.get("data_release_version", {})
    if (
        f"{live_gdc_version.get('major')}.{live_gdc_version.get('minor')}"
        != manifest.gdc_data_release_version
    ):
        differences.append("GDC data release")
    if differences:
        raise AcquisitionError("live release drift: " + ", ".join(differences))
    return {
        "TCIA": manifest.tcia_collection_version,
        "PDC": ", ".join(sorted(live_versions)),
        "GDC": manifest.gdc_data_release_version,
    }
