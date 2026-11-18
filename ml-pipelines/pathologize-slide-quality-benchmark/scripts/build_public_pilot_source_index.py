from __future__ import annotations

import hashlib
import io
import json
import re
import tarfile
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import fire

BENCHMARK_ROOT = Path(__file__).resolve().parents[1]
REGISTRY_ROOT = BENCHMARK_ROOT.parent / "pathologize-data-registry"
ANNOTATION_ROOT = REGISTRY_ROOT / "data/raw/airaqc-tcga/public-pilot-v1/annotations"
OUTPUT = BENCHMARK_ROOT / "public-pilot/source-index.json"
DEPOSIT_URL = (
    "https://zenodo.org/records/22932961/files/diffusionqc-reproduction-complete.tar.gz?download=1"
)
DRIVE_URL = "https://drive.google.com/drive/folders/1Z3oNTqG2JZdbj--b0te8TMPzFlzhN0oN?usp=sharing"


def _fetch(url: str) -> bytes:
    request = Request(  # noqa: S310 - fixed public HTTPS sources.
        url, headers={"User-Agent": "pathologize-public-pilot/0.1"}
    )
    with urlopen(request, timeout=120) as response:  # noqa: S310 - fixed public HTTPS sources.
        return response.read()


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _deposit_split(archive: bytes) -> tuple[dict[str, Any], str]:
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as bundle:
        member = bundle.getmember("diffusionqc-reproduction/data/train_test_split.json")
        stream = bundle.extractfile(member)
        if stream is None:
            raise ValueError("reproducibility deposit has no train/test split")
        payload = stream.read()
    value = json.loads(payload)
    if not isinstance(value, dict):
        raise TypeError("train/test split must be an object")
    return value, _sha256_bytes(payload)


def _drive_assets(page: bytes) -> dict[str, str]:
    text = page.decode("utf-8")
    rows = re.findall(
        r'aria-label="(TCGA-[^"]+\.png) Image Shared".*?data-id="([A-Za-z0-9_-]+)"',
        text,
        re.DOTALL,
    )
    result = dict(rows)
    if len(result) != 50:
        raise ValueError(f"expected 50 annotation assets, found {len(result)}")
    return result


def _gdc_files(file_names: list[str]) -> list[dict[str, Any]]:
    filters = {"op": "in", "content": {"field": "file_name", "value": file_names}}
    query = urlencode(
        {
            "filters": json.dumps(filters, separators=(",", ":")),
            "fields": (
                "file_id,file_name,file_size,md5sum,cases.case_id,cases.submitter_id,"
                "cases.project.project_id"
            ),
            "size": "100",
        }
    )
    payload = json.loads(_fetch(f"https://api.gdc.cancer.gov/files?{query}"))
    hits = payload["data"]["hits"]
    if len(hits) != len(file_names):
        raise ValueError(f"expected {len(file_names)} GDC files, found {len(hits)}")
    return hits


def build(base_revision: str) -> None:
    if not re.fullmatch(r"[a-f0-9]{40}", base_revision):
        raise ValueError("base_revision must be a full Git commit")
    archive = _fetch(DEPOSIT_URL)
    split, split_sha256 = _deposit_split(archive)
    drive_assets = _drive_assets(_fetch(DRIVE_URL))
    all_annotation_names = sorted(drive_assets)
    all_slide_names = [name.removesuffix(".png") + ".svs" for name in all_annotation_names]
    all_gdc = _gdc_files(all_slide_names)
    by_name = {item["file_name"]: item for item in all_gdc}
    slides: list[dict[str, Any]] = []
    for file_name in split["test_slides"]:
        annotation_name = file_name.removesuffix(".svs") + ".png"
        annotation_path = ANNOTATION_ROOT / annotation_name
        source = by_name[file_name]
        case = source["cases"][0]
        slides.append(
            {
                "file_id": source["file_id"],
                "file_name": file_name,
                "file_size": source["file_size"],
                "md5sum": source["md5sum"],
                "case_id": case["case_id"],
                "patient_id": case["submitter_id"],
                "project_id": case["project"]["project_id"],
                "slide_barcode": file_name.split(".", maxsplit=1)[0],
                "annotation_name": annotation_name,
                "annotation_file_id": drive_assets[annotation_name],
                "annotation_bytes": annotation_path.stat().st_size,
                "annotation_sha256": _sha256_file(annotation_path),
            }
        )
    exclusions = [
        {"slide_id": name, "reason": "unused_by_fixed_partition"} for name in split["unused_slides"]
    ]
    exclusions.extend(
        {"slide_id": name, "reason": "source_partition_marked_unusable"}
        for name in split["excluded_unusable"]
    )
    exclusions.extend(
        {
            "slide_id": item[0],
            "reason": "source_partition_low_tissue",
            "eligible_patches": item[1],
        }
        for item in split["excluded_low_tissue"]
    )
    output = {
        "schema_version": "1.0.0",
        "base_revision": base_revision,
        "known_slide_bytes": sum(item["file_size"] for item in all_gdc),
        "slides": slides,
        "exclusions": exclusions,
        "failed_acquisitions": [],
        "provenance": {
            "airaqc_paper": "https://openreview.net/pdf?id=XNNsQqs1UP",
            "airaqc_annotation_folder": DRIVE_URL,
            "gdc_api": "https://api.gdc.cancer.gov/",
            "reliability_deposit_doi": "10.5281/zenodo.22932961",
            "reliability_deposit_archive_sha256": _sha256_bytes(archive),
            "fixed_partition_sha256": split_sha256,
            "retrieved_at": "2026-11-07",
            "source_review": [
                {
                    "source": "AIRAQc TCGA test annotations",
                    "decision": "selected",
                    "reason": (
                        "Fixed patient-level slides, clean negatives, four pixel-level defect "
                        "classes, GDC source identity, and Aperio scanner serials."
                    ),
                },
                {
                    "source": "GrandQC TCGA masks",
                    "decision": "rejected_as_ground_truth",
                    "reason": (
                        "Model-produced masks are non-commercial and are not reference labels."
                    ),
                },
                {
                    "source": "HistoArtifacts",
                    "decision": "rejected",
                    "reason": "No declared licence or stable patient and scanner identities.",
                },
                {
                    "source": "Augsburg scanner comparison",
                    "decision": "rejected_for_this_pilot",
                    "reason": (
                        "Strong scanner and rating metadata, but a bounded stable download route "
                        "was not documented well enough before the acquisition decision."
                    ),
                },
            ],
        },
    }
    OUTPUT.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        f"Wrote {len(slides)} selected slides; "
        f"source bytes={sum(item['file_size'] for item in slides)}."
    )


def main() -> None:
    fire.Fire({"build": build})


if __name__ == "__main__":
    main()
