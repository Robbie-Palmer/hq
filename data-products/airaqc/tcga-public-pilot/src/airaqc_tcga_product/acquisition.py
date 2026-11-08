from __future__ import annotations

import hashlib
import os
import shutil
from contextlib import closing
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from airaqc_tcga_product.models import Asset, AssetManifest, Collection, Subset
from airaqc_tcga_product.product import PROJECT_DIR, ProductError, _read_object


def _source_allowed(source_url: str, allowed_prefixes: list[str]) -> bool:
    source = urlsplit(source_url)
    return any(
        source.scheme == base.scheme == "https"
        and source.hostname == base.hostname
        and source.port == base.port
        and source.path.startswith(base.path)
        for base in (urlsplit(prefix) for prefix in allowed_prefixes)
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _require_download_matches(path: Path, asset: Asset) -> None:
    if path.stat().st_size != asset.bytes or _sha256(path) != asset.sha256:
        raise ProductError(f"downloaded asset differs: {asset.relative_path}")


def acquire_product(root: Path = PROJECT_DIR, max_bytes: int = 16_500_000_000) -> int:
    collection = Collection.model_validate(_read_object(root / "contracts/collection.json"))
    subset = Subset.model_validate(_read_object(root / "contracts/subset.json"))
    assets = AssetManifest.model_validate(_read_object(root / "contracts/assets.json"))
    if subset.total_bytes > max_bytes:
        raise ProductError(f"product requires {subset.total_bytes} bytes, limit is {max_bytes}")
    allowed = [str(value) for value in collection.access.download_base_urls]
    installed = 0
    asset_root = root / subset.asset_root
    for asset in assets.assets:
        destination = asset_root / asset.relative_path
        if (
            destination.is_file()
            and not destination.is_symlink()
            and destination.stat().st_size == asset.bytes
            and _sha256(destination) == asset.sha256
        ):
            continue
        source_url = str(asset.source_url)
        if not _source_allowed(source_url, allowed):
            raise ProductError(f"source URL is not allowlisted: {source_url}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(f".{destination.name}.part")
        temporary.unlink(missing_ok=True)
        request = Request(  # noqa: S310 - collection contracts allowlist HTTPS prefixes.
            source_url,
            headers={"User-Agent": "airaqc-tcga-public-pilot/0.1 (+data-product)"},
        )
        try:
            with closing(urlopen(request, timeout=60)) as response, temporary.open("wb") as output:  # noqa: S310
                shutil.copyfileobj(response, output, length=1024 * 1024)
                output.flush()
                os.fsync(output.fileno())
            _require_download_matches(temporary, asset)
            temporary.replace(destination)
            installed += 1
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    return installed
