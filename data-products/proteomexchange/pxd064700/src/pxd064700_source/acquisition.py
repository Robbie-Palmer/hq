from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory

from data_artifacts.acquisition import (
    AcquisitionError,
    HttpsMetadataClient,
    RemoteFile,
    html_directory_basenames,
    list_anonymous_ftp_files,
    normalize_line_endings,
)
from data_artifacts.files import sha256_file, write_json, write_jsonl

from pxd064700_source.models import SnapshotFile, SnapshotManifest

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
ALLOWED_HTTPS_HOSTS = frozenset(
    {
        "www.ebi.ac.uk",
        "ftp.pride.ebi.ac.uk",
        "proteomecentral.proteomexchange.org",
    }
)
_METADATA_CLIENT = HttpsMetadataClient(
    allowed_hosts=ALLOWED_HTTPS_HOSTS,
    user_agent="pxd064700-source-data/0.1 (+metadata-only)",
)


def _request(url: str) -> bytes:
    return _METADATA_CLIENT.get_bytes(url)


def _json_request(url: str) -> dict[str, object]:
    return _METADATA_CLIENT.get_json_object(url)


def _ftp_entries() -> list[RemoteFile]:
    return list_anonymous_ftp_files(FTP_HOST, FTP_DIR)


def _write_bytes(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(value)


def _snapshot_file(path: Path, published_path: Path) -> SnapshotFile:
    return SnapshotFile(
        path=published_path.as_posix(),
        bytes=path.stat().st_size,
        sha256=sha256_file(path),
    )


def refresh_snapshots(root: Path = PROJECT_DIR) -> SnapshotManifest:
    root.mkdir(parents=True, exist_ok=True)
    snapshots = root / "snapshots"
    with TemporaryDirectory(prefix=".pxd064700-refresh-", dir=root) as temporary:
        staging_root = Path(temporary)
        staged_snapshots = staging_root / "snapshots"
        staged_snapshots.mkdir()

        project = _json_request(PROJECT_API_URL)
        write_json(staged_snapshots / "pride-project.json", project)
        _write_bytes(
            staged_snapshots / "proteomexchange-announcement.xml",
            _request(ANNOUNCEMENT_URL),
        )
        entries = _ftp_entries()
        write_jsonl(staged_snapshots / "ftp-listing.jsonl", entries)
        for local_name, url in METADATA_FILES.items():
            payload = _request(url)
            if local_name in {"donor-name-map.tsv", "experiment-overview.txt"}:
                payload = normalize_line_endings(payload)
            _write_bytes(staged_snapshots / local_name, payload)

        snapshot_paths = sorted(staged_snapshots.iterdir())
        manifest = SnapshotManifest(
            schema_version="1.0.0",
            product_id="proteomexchange-pxd064700-revision-1",
            retrieved_at=datetime.now(UTC).replace(microsecond=0).isoformat(),
            acquisition_mode="public_metadata_only",
            requires_credentials=False,
            files=[_snapshot_file(path, Path("snapshots") / path.name) for path in snapshot_paths],
        )
        write_json(staged_snapshots / "snapshot-manifest.json", manifest)

        previous_snapshots = staging_root / "previous-snapshots"
        if snapshots.exists():
            snapshots.replace(previous_snapshots)
        try:
            staged_snapshots.replace(snapshots)
        except OSError:
            if previous_snapshots.exists():
                previous_snapshots.replace(snapshots)
            raise
        return manifest


def verify_live_identity(root: Path = PROJECT_DIR) -> dict[str, object]:
    from pxd064700_source.product import (
        announcement_files,
        announcement_files_from_bytes,
        read_ftp_entries,
    )

    project = _json_request(PROJECT_API_URL)
    if project.get("accession") != ACCESSION:
        raise AcquisitionError("live PRIDE accession differs from PXD064700")
    if project.get("submissionType") != "PARTIAL":
        raise AcquisitionError("live PRIDE submission type differs from PARTIAL")

    pinned_announcement = announcement_files(root / "snapshots/proteomexchange-announcement.xml")
    live_announcement = announcement_files_from_bytes(_request(ANNOUNCEMENT_URL))
    if set(live_announcement) != set(pinned_announcement):
        raise AcquisitionError("live ProteomeXchange revision 1 file identities drifted")

    pinned_ftp = {item.file_name for item in read_ftp_entries(root / "snapshots/ftp-listing.jsonl")}
    live_ftp = html_directory_basenames(_request(DIRECTORY_URL))
    if live_ftp != pinned_ftp:
        raise AcquisitionError("live PRIDE FTP directory identities drifted")
    return {
        "accession": ACCESSION,
        "submission_type": "PARTIAL",
        "announcement_file_count": len(live_announcement),
        "ftp_file_count": len(live_ftp),
    }
