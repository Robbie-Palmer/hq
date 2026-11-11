from __future__ import annotations

import hashlib
import json
import os
import shutil
from contextlib import closing
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from bcss_source_data.models import NativeCorpus
from bcss_source_data.product import PROJECT_DIR, ProductError, _read_object

FIGSHARE_MASK_PREFIX = "https://ndownloader.figshare.com/files/"


def _digest(path: Path, algorithm: str) -> str:
    digest = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _source_allowed(source_url: str) -> bool:
    source = urlsplit(source_url)
    allowed = urlsplit(FIGSHARE_MASK_PREFIX)
    return (
        source.scheme == allowed.scheme == "https"
        and source.hostname == allowed.hostname
        and source.port == allowed.port
        and source.path.startswith(allowed.path)
        and source.query == ""
        and source.fragment == ""
    )


def _verify_mask(path: Path, *, size: int, md5: str, sha256: str) -> None:
    if (
        path.stat().st_size != size
        or _digest(path, "md5") != md5
        or _digest(path, "sha256") != sha256
    ):
        raise ProductError(f"downloaded mask differs: {path.name}")


def acquire_masks(root: Path = PROJECT_DIR, max_bytes: int = 40_000_000) -> int:
    corpus = NativeCorpus.model_validate(_read_object(root / "records/native-corpus.json"))
    total_bytes = sum(record.mask.bytes for record in corpus.records)
    if total_bytes > max_bytes:
        raise ProductError(f"BCSS masks require {total_bytes} bytes, limit is {max_bytes}")
    output = root / "data/raw/masks"
    installed = 0
    for record in corpus.records:
        artifact = record.mask
        destination = output / artifact.name
        md5 = artifact.digests.md5
        sha256 = artifact.digests.sha256
        if md5 is None or sha256 is None:
            raise ProductError(f"mask lacks both required digests: {artifact.name}")
        if destination.is_file() and not destination.is_symlink():
            try:
                _verify_mask(destination, size=artifact.bytes, md5=md5, sha256=sha256)
                continue
            except ProductError:
                pass
        source_url = str(artifact.url)
        if not _source_allowed(source_url):
            raise ProductError(f"source URL is not allowlisted: {source_url}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(f".{destination.name}.part")
        temporary.unlink(missing_ok=True)
        request = Request(  # noqa: S310 - the exact HTTPS Figshare path is allowlisted.
            source_url,
            headers={"User-Agent": "bcss-source-data/0.1 (+data-product)"},
        )
        try:
            with closing(urlopen(request, timeout=60)) as response, temporary.open("wb") as target:  # noqa: S310
                shutil.copyfileobj(response, target, length=1024 * 1024)
                target.flush()
                os.fsync(target.fileno())
            _verify_mask(temporary, size=artifact.bytes, md5=md5, sha256=sha256)
            temporary.replace(destination)
            installed += 1
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    evidence = {
        "dataset_id": corpus.dataset_id,
        "mask_count": len(corpus.records),
        "mask_bytes": total_bytes,
    }
    (output / "acquisition.json").write_text(
        json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return installed
