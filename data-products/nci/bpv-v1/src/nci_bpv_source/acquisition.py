from __future__ import annotations

import hashlib
from contextlib import closing
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen

from nci_bpv_source.models import PublicMetadataFile
from nci_bpv_source.product import PROJECT_DIR, ProductError, load_contracts

DB_GAP_PREFIX = "/dbgap/studies/phs001304/phs001304.v1.p1/"
LIVE_PAGES = {
    "https://www.ncbi.nlm.nih.gov/projects/gap/cgi-bin/study.cgi?study_id=phs001304.v1.p1": (
        "phs001304.v1.p1",
        "phs001634.v1.p1",
        "phs001640.v1.p1",
        "Total number of consented subjects: 153",
    ),
    "https://www.ncbi.nlm.nih.gov/bioproject/932917": (
        "PRJNA932917",
        "Biospecimen Pre-analytical Variables",
    ),
}


def _allowed_url(url: str) -> bool:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.port is not None or parsed.username is not None:
        return False
    if parsed.hostname == "ftp.ncbi.nlm.nih.gov":
        return parsed.path.startswith(DB_GAP_PREFIX) and not parsed.query and not parsed.fragment
    if parsed.hostname != "www.ncbi.nlm.nih.gov" or parsed.fragment:
        return False
    if parsed.path == "/projects/gap/cgi-bin/study.cgi":
        return parse_qs(parsed.query) == {"study_id": ["phs001304.v1.p1"]}
    return parsed.path == "/bioproject/932917" and not parsed.query


def _get_bytes(url: str) -> bytes:
    if not _allowed_url(url):
        raise ProductError(f"NCI BPV metadata URL is not allowlisted: {url}")
    request = Request(  # noqa: S310 - the exact HTTPS hosts and paths are checked above.
        url,
        headers={"User-Agent": "nci-bpv-source/0.1 (+metadata-only-data-product)"},
    )
    with closing(urlopen(request, timeout=60)) as response:  # noqa: S310
        final_url = response.geturl()
        if not _allowed_url(final_url):
            raise ProductError(f"NCI BPV metadata redirect is not allowlisted: {final_url}")
        return response.read()


def _validate_download(artifact: PublicMetadataFile, content: bytes) -> None:
    if len(content) != artifact.bytes:
        raise ProductError(f"{artifact.file_name}: live byte count differs from inventory")
    if hashlib.sha256(content).hexdigest() != artifact.sha256:
        raise ProductError(f"{artifact.file_name}: live SHA-256 differs from inventory")


def acquire_public_metadata(root: Path = PROJECT_DIR) -> dict[str, int]:
    _study, inventory, _rights, _identity = load_contracts(root)
    downloads = {
        artifact.file_name: _get_bytes(str(artifact.url))
        for artifact in inventory.public_metadata_files
    }
    for artifact in inventory.public_metadata_files:
        _validate_download(artifact, downloads[artifact.file_name])
    destination = root / "fixtures/public-metadata"
    destination.mkdir(parents=True, exist_ok=True)
    for name, content in downloads.items():
        (destination / name).write_bytes(content)
    return {
        "bytes": sum(len(content) for content in downloads.values()),
        "files": len(downloads),
    }


def check_live_metadata(root: Path = PROJECT_DIR) -> dict[str, int]:
    _study, inventory, _rights, _identity = load_contracts(root)
    checked_bytes = 0
    for artifact in inventory.public_metadata_files:
        content = _get_bytes(str(artifact.url))
        _validate_download(artifact, content)
        checked_bytes += len(content)
    for url, expected_tokens in LIVE_PAGES.items():
        content = _get_bytes(url).decode("utf-8", errors="replace")
        missing = [token for token in expected_tokens if token not in content]
        if missing:
            raise ProductError(f"{url}: live page is missing pinned BPV identifiers")
    return {
        "bytes": checked_bytes,
        "pages": len(LIVE_PAGES),
        "pinned_files": len(inventory.public_metadata_files),
    }
