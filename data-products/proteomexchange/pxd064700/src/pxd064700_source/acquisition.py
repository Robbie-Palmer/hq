from __future__ import annotations

import ftplib
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from pxd064700_source.models import FtpEntry, SnapshotFile, SnapshotManifest

PROJECT_DIR = Path(__file__).resolve().parents[2]
ACCESSION = "PXD064700"
FTP_HOST = "ftp.pride.ebi.ac.uk"
FTP_DIR = "/pride/data/archive/2026/03/PXD064700"
HTTPS_ROOT = f"https://{FTP_HOST}{FTP_DIR}"
PROJECT_API_URL = f"https://www.ebi.ac.uk/pride/ws/archive/v3/projects/{ACCESSION}"
ANNOUNCEMENT_URL = (
    "https://proteomecentral.proteomexchange.org/cgi/"
    "GetDataset?ID=PXD064700.0-1&outputMode=XML&test=no"
)
DIRECTORY_URL = f"{HTTPS_ROOT}/"
METADATA_FILES = {
    "checksum.txt": f"{HTTPS_ROOT}/checksum.txt",
    "community-annotation.sdrf.tsv": f"{HTTPS_ROOT}/PXD064700_community_annotated.sdrf.tsv",
    "experiment-overview.txt": f"{HTTPS_ROOT}/experiment_overview_and_software.txt",
    "donor-name-map.tsv": (
        f"{HTTPS_ROOT}/reference_case_name_for_raw_data_equivalent_body_donor_number.txt"
    ),
}
ALLOWED_HTTPS_HOSTS = {
    "www.ebi.ac.uk",
    "ftp.pride.ebi.ac.uk",
    "proteomecentral.proteomexchange.org",
}


class AcquisitionError(RuntimeError):
    pass


def _request(url: str) -> bytes:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HTTPS_HOSTS:
        raise AcquisitionError(f"metadata URL is not allowlisted: {url}")
    request = Request(  # noqa: S310 - exact HTTPS hosts are allowlisted above.
        url,
        headers={
            "Accept": "application/json, application/xml, text/plain, text/html",
            "User-Agent": "pxd064700-source-data/0.1 (+metadata-only)",
        },
    )
    with urlopen(request, timeout=120) as response:  # noqa: S310
        return response.read()


def _json_request(url: str) -> dict[str, Any]:
    value = json.loads(_request(url))
    if not isinstance(value, dict):
        raise AcquisitionError(f"metadata endpoint did not return an object: {url}")
    return cast(dict[str, Any], value)


def _ftp_entries() -> list[FtpEntry]:
    lines: list[str] = []
    with ftplib.FTP(FTP_HOST, timeout=120) as client:  # noqa: S321 - public metadata only.
        client.login()
        client.cwd(FTP_DIR)
        client.retrlines("LIST", lines.append)
    entries: list[FtpEntry] = []
    for line in lines:
        fields = line.split(maxsplit=8)
        if len(fields) != 9 or not fields[0].startswith("-"):
            raise AcquisitionError(f"unexpected FTP listing row: {line}")
        file_name = fields[8]
        entries.append(
            FtpEntry(
                file_name=file_name,
                bytes=int(fields[4]),
                locator=f"ftp://{FTP_HOST}{FTP_DIR}/{file_name}",
            )
        )
    if len({item.file_name for item in entries}) != len(entries):
        raise AcquisitionError("FTP listing contains duplicate basenames")
    return sorted(entries, key=lambda item: item.file_name)


def _write_bytes(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(value)


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _write_jsonl(path: Path, values: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(value, sort_keys=True) + "\n" for value in values),
        encoding="utf-8",
    )


def _normalize_line_endings(payload: bytes) -> bytes:
    return payload.replace(b"\r\n", b"\n").rstrip(b"\n") + b"\n"


def _snapshot_file(path: Path, root: Path) -> SnapshotFile:
    payload = path.read_bytes()
    return SnapshotFile(
        path=path.relative_to(root).as_posix(),
        bytes=len(payload),
        sha256=hashlib.sha256(payload).hexdigest(),
    )


def refresh_snapshots(root: Path = PROJECT_DIR) -> SnapshotManifest:
    snapshots = root / "snapshots"
    project = _json_request(PROJECT_API_URL)
    _write_json(snapshots / "pride-project.json", project)
    _write_bytes(snapshots / "proteomexchange-announcement.xml", _request(ANNOUNCEMENT_URL))
    entries = _ftp_entries()
    _write_jsonl(
        snapshots / "ftp-listing.jsonl",
        [item.model_dump(mode="json") for item in entries],
    )
    for local_name, url in METADATA_FILES.items():
        payload = _request(url)
        if local_name in {"donor-name-map.tsv", "experiment-overview.txt"}:
            payload = _normalize_line_endings(payload)
        _write_bytes(snapshots / local_name, payload)

    snapshot_paths = sorted(
        path
        for path in snapshots.iterdir()
        if path.is_file() and path.name != "snapshot-manifest.json"
    )
    manifest = SnapshotManifest(
        schema_version="1.0.0",
        product_id="proteomexchange-pxd064700-revision-1",
        retrieved_at=datetime.now(UTC).replace(microsecond=0).isoformat(),
        acquisition_mode="public_metadata_only",
        requires_credentials=False,
        files=[_snapshot_file(path, root) for path in snapshot_paths],
    )
    _write_json(snapshots / "snapshot-manifest.json", manifest.model_dump(mode="json"))
    return manifest


def _directory_basenames(payload: bytes) -> set[str]:
    text = payload.decode("utf-8")
    marker = 'href="'
    names: set[str] = set()
    for fragment in text.split(marker)[1:]:
        href = fragment.split('"', 1)[0]
        if href and not href.startswith(("?", "/")):
            names.add(href)
    return names


def verify_live_identity(root: Path = PROJECT_DIR) -> dict[str, object]:
    from pxd064700_source.product import announcement_files, read_ftp_entries

    project = _json_request(PROJECT_API_URL)
    if project.get("accession") != ACCESSION:
        raise AcquisitionError("live PRIDE accession differs from PXD064700")
    if project.get("submissionType") != "PARTIAL":
        raise AcquisitionError("live PRIDE submission type differs from PARTIAL")

    pinned_announcement = announcement_files(root / "snapshots/proteomexchange-announcement.xml")
    live_path = root / "snapshots/.live-announcement.xml"
    live_path.write_bytes(_request(ANNOUNCEMENT_URL))
    try:
        live_announcement = announcement_files(live_path)
    finally:
        live_path.unlink(missing_ok=True)
    if set(live_announcement) != set(pinned_announcement):
        raise AcquisitionError("live ProteomeXchange revision 1 file identities drifted")

    pinned_ftp = {item.file_name for item in read_ftp_entries(root / "snapshots/ftp-listing.jsonl")}
    live_ftp = _directory_basenames(_request(DIRECTORY_URL))
    if live_ftp != pinned_ftp:
        raise AcquisitionError("live PRIDE FTP directory identities drifted")
    return {
        "accession": ACCESSION,
        "submission_type": "PARTIAL",
        "announcement_file_count": len(live_announcement),
        "ftp_file_count": len(live_ftp),
    }
