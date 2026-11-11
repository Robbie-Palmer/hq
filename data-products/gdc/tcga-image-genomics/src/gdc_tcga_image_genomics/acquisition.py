from __future__ import annotations

import json
from contextlib import closing
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from gdc_tcga_image_genomics.models import ApiPage, QuerySpec
from gdc_tcga_image_genomics.product import (
    PROJECT_DIR,
    ProductError,
    _write_json,
    load_contracts,
    publish_product,
    validate_status,
)


def _allowed_url(url: str) -> bool:
    parsed = urlsplit(url)
    return (
        parsed.scheme == "https" and parsed.hostname == "api.gdc.cancer.gov" and parsed.port is None
    )


def _get_json(url: str, parameters: dict[str, str] | None = None) -> dict[str, object]:
    if not _allowed_url(url):
        raise ProductError(f"GDC URL is not allowlisted: {url}")
    target = f"{url}?{urlencode(parameters)}" if parameters else url
    request = Request(  # noqa: S310 - exact GDC HTTPS host is checked above.
        target,
        headers={"User-Agent": "gdc-tcga-image-genomics/0.1 (+data-product)"},
    )
    with closing(urlopen(request, timeout=120)) as response:  # noqa: S310
        payload = json.load(response)
    if not isinstance(payload, dict):
        raise ProductError(f"GDC response from {url} is not an object")
    return payload


def _query_parameters(query: QuerySpec, offset: int) -> dict[str, str]:
    return {
        "filters": json.dumps(query.filters, separators=(",", ":"), sort_keys=True),
        "fields": ",".join(query.fields),
        "expand": ",".join(query.expand),
        "size": str(query.page_size),
        "from": str(offset),
        "sort": query.sort,
    }


def _fetch_query(query: QuerySpec, destination: Path) -> int:
    destination.mkdir(parents=True, exist_ok=True)
    for stale_page in destination.glob("page-*.json"):
        stale_page.unlink()
    offset = 0
    page_number = 0
    total: int | None = None
    while total is None or offset < total:
        payload = _get_json(str(query.endpoint), _query_parameters(query, offset))
        page = ApiPage.model_validate(payload)
        pagination = page.data.pagination
        if pagination.from_ != offset or pagination.count != len(page.data.hits):
            raise ProductError(f"{query.query_id}: GDC returned non-contiguous pagination")
        if total is None:
            total = pagination.total
            if total != query.expected_full_release_count:
                raise ProductError(
                    f"{query.query_id}: release count is {total}, "
                    f"expected {query.expected_full_release_count}"
                )
        elif total != pagination.total:
            raise ProductError(f"{query.query_id}: GDC total changed during retrieval")
        if pagination.count == 0 and offset < total:
            raise ProductError(f"{query.query_id}: GDC returned an empty page before completion")
        _write_json(destination / f"page-{page_number:05d}.json", payload)
        offset += pagination.count
        page_number += 1
    return offset


def refresh_product(root: Path = PROJECT_DIR) -> dict[str, object]:
    release, queries = load_contracts(root)
    source_root = root / "metadata/raw"
    first_status = _get_json(str(release.status_url))
    validate_status(first_status, release)
    _write_json(source_root / "status.json", first_status)
    counts = {
        query.query_id: _fetch_query(query, source_root / query.query_id)
        for query in queries.queries
    }
    final_status = _get_json(str(release.status_url))
    validate_status(final_status, release)
    if final_status.get("data_release") != first_status.get("data_release"):
        raise ProductError("GDC data release changed during retrieval")
    metrics = publish_product(source_root, root / "outputs/native", root=root)
    return {"query_counts": counts, "metrics": metrics}
