from __future__ import annotations

import hashlib
import json
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, cast

from cryonuseg_source_data.models import GdcSlide
from cryonuseg_source_data.product import (
    PROJECT_DIR,
    ProductError,
    load_contract,
    load_gdc_slides,
)

MAX_METADATA_BYTES = 4 * 1024 * 1024


def _fetch_bytes(url: str, max_bytes: int = MAX_METADATA_BYTES) -> bytes:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https":
        raise ProductError("source checks require HTTPS")
    request = urllib.request.Request(  # noqa: S310 - HTTPS is checked above and after redirects.
        url, headers={"User-Agent": "cryonuseg-source-data/0.1 (+metadata-check)"}
    )
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310
        if urllib.parse.urlsplit(response.geturl()).scheme != "https":
            raise ProductError("source metadata redirected away from HTTPS")
        payload = response.read(max_bytes + 1)
    if len(payload) > max_bytes:
        raise ProductError("source metadata exceeds the bounded response size")
    return payload


def _fetch_json(url: str) -> dict[str, Any]:
    payload = json.loads(_fetch_bytes(url))
    if not isinstance(payload, dict):
        raise ProductError("source metadata response must be a JSON object")
    return cast(dict[str, Any], payload)


def _gdc_url(slides: list[GdcSlide]) -> str:
    filters = {
        "op": "in",
        "content": {"field": "files.file_id", "value": [slide.file_id for slide in slides]},
    }
    fields = ",".join(
        [
            "file_id",
            "file_name",
            "md5sum",
            "file_size",
            "state",
            "access",
            "data_category",
            "data_type",
            "data_format",
            "experimental_strategy",
            "submitter_id",
            "cases.case_id",
            "cases.submitter_id",
            "cases.project.project_id",
            "cases.samples.submitter_id",
            "cases.samples.sample_type",
            "cases.samples.tissue_type",
            "cases.samples.portions.submitter_id",
            "cases.samples.portions.slides.submitter_id",
        ]
    )
    query = urllib.parse.urlencode(
        {"filters": json.dumps(filters, separators=(",", ":")), "fields": fields, "size": 100}
    )
    return f"https://api.gdc.cancer.gov/files?{query}"


def _flatten_gdc_hit(hit: dict[str, Any]) -> GdcSlide:
    case = hit["cases"][0]
    sample = case["samples"][0]
    portion = sample["portions"][0]
    return GdcSlide.model_validate(
        {
            **{key: hit[key] for key in GdcSlide.model_fields if key in hit},
            "tcga_patient_barcode": case["submitter_id"],
            "case_id": case["case_id"],
            "project_id": case["project"]["project_id"],
            "sample_submitter_id": sample["submitter_id"],
            "sample_type": sample["sample_type"],
            "tissue_type": sample["tissue_type"],
            "portion_submitter_id": portion["submitter_id"],
            "slide_submitter_id": portion["slides"][0]["submitter_id"],
        }
    )


def _query_gdc(slides: list[GdcSlide]) -> list[GdcSlide]:
    payload = _fetch_json(_gdc_url(slides))
    hits = payload.get("data", {}).get("hits", [])
    if not isinstance(hits, list):
        raise ProductError("GDC response does not contain file hits")
    return [_flatten_gdc_hit(hit) for hit in hits]


def check_sources(root: Path = PROJECT_DIR) -> dict[str, int]:
    contract = load_contract(root)
    expected_slides = load_gdc_slides(root)

    kaggle = _fetch_json(str(contract.kaggle.metadata_api_url))
    observed_kaggle = {
        "ref": kaggle.get("ref"),
        "version": kaggle.get("currentVersionNumber"),
        "updated_at": kaggle.get("lastUpdated"),
        "total_bytes": kaggle.get("totalBytes"),
        "license": kaggle.get("licenseName"),
    }
    expected_kaggle = {
        "ref": contract.kaggle.dataset_ref,
        "version": contract.kaggle.version,
        "updated_at": contract.kaggle.updated_at,
        "total_bytes": contract.kaggle.reported_total_bytes,
        "license": contract.kaggle.license_label,
    }
    if observed_kaggle != expected_kaggle:
        raise ProductError("Kaggle metadata differs from the pinned v7 contract")

    commit = _fetch_json(str(contract.github.commit_api_url))
    if commit.get("sha") != contract.github.commit:
        raise ProductError("GitHub commit differs from the pinned publisher revision")
    workbook = _fetch_bytes(str(contract.github.selected_wsis_url))
    if hashlib.sha256(workbook).hexdigest() != contract.github.selected_wsis_sha256:
        raise ProductError("Selected_WSIs.xlsx differs from the pinned digest")

    current_slides = _query_gdc(expected_slides)
    expected_by_id = {slide.file_id: slide for slide in expected_slides}
    current_by_id = {slide.file_id: slide for slide in current_slides}
    if current_by_id != expected_by_id:
        raise ProductError("GDC Tissue Slide metadata differs from the pinned source snapshot")
    return {
        "kaggle_versions_checked": 1,
        "github_revisions_checked": 1,
        "selected_wsis_files_checked": 1,
        "gdc_slides_checked": len(current_slides),
    }


def verify_archive(path: Path, root: Path = PROJECT_DIR) -> None:
    contract = load_contract(root)
    if path.stat().st_size != contract.archive.compressed_bytes:
        raise ProductError("CryoNuSeg archive byte count differs from the pinned v7 bundle")
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != contract.archive.sha256:
        raise ProductError("CryoNuSeg archive SHA-256 differs from the pinned v7 bundle")
