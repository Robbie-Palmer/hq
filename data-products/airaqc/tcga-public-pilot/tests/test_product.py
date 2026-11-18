import hashlib
import io
import json
from pathlib import Path

import pytest

from airaqc_tcga_product import acquisition
from airaqc_tcga_product.acquisition import _source_allowed, acquire_product
from airaqc_tcga_product.product import ProductError, publish_product

PROJECT_DIR = Path(__file__).resolve().parents[1]


def _write_acquisition_contracts(
    root: Path,
    payload: bytes,
    *,
    source_url: str = "https://example.test/data/asset.bin",
    sha256: str | None = None,
) -> Path:
    contracts = root / "contracts"
    contracts.mkdir()
    (contracts / "collection.json").write_text(
        json.dumps(
            {
                "collection_id": "collection",
                "access": {"download_base_urls": ["https://example.test/data/"]},
            }
        ),
        encoding="utf-8",
    )
    (contracts / "subset.json").write_text(
        json.dumps(
            {
                "subset_id": "subset",
                "collection_id": "collection",
                "asset_root": "data/raw",
                "asset_manifest_id": "assets",
                "slide_ids": ["slide"],
                "asset_count": 1,
                "total_bytes": len(payload),
            }
        ),
        encoding="utf-8",
    )
    (contracts / "assets.json").write_text(
        json.dumps(
            {
                "asset_manifest_id": "assets",
                "subset_id": "subset",
                "schema_version": 1,
                "assets": [
                    {
                        "relative_path": "asset.bin",
                        "source_url": source_url,
                        "bytes": len(payload),
                        "sha256": sha256 or hashlib.sha256(payload).hexdigest(),
                        "image_role": "fixture",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    return root / "data/raw/asset.bin"


def test_publish_validates_and_preserves_native_contract(tmp_path: Path) -> None:
    (tmp_path / "contracts").symlink_to(PROJECT_DIR / "contracts", target_is_directory=True)
    (tmp_path / "records").symlink_to(PROJECT_DIR / "records", target_is_directory=True)

    metrics = publish_product(tmp_path)

    assert metrics["slide_count"] == 24
    assert metrics["patient_count"] == 24
    assert metrics["asset_count"] == 48
    assert metrics["raw_bytes"] == 15_813_730_059
    published = json.loads((tmp_path / "outputs/native-corpus.json").read_text(encoding="utf-8"))
    assert published["corpus_id"] == "airaqc-tcga-public-pilot-v1"
    assert {label for slide in published["slides"] for label in slide["annotation_counts"]} == {
        "air_bubble",
        "fold",
        "out_of_focus",
        "penmark",
    }


def test_publish_rejects_changed_subset_identity(tmp_path: Path) -> None:
    contracts = tmp_path / "contracts"
    contracts.mkdir()
    for name in ("assets.json", "collection.json", "source-index.json"):
        (contracts / name).write_text(
            (PROJECT_DIR / "contracts" / name).read_text(encoding="utf-8"), encoding="utf-8"
        )
    subset = json.loads((PROJECT_DIR / "contracts/subset.json").read_text(encoding="utf-8"))
    subset["slide_ids"] = subset["slide_ids"][:-1]
    (contracts / "subset.json").write_text(json.dumps(subset), encoding="utf-8")
    (tmp_path / "records").symlink_to(PROJECT_DIR / "records", target_is_directory=True)

    with pytest.raises(ProductError, match="corpus slides differ"):
        publish_product(tmp_path)


def test_acquisition_refuses_a_smaller_byte_budget() -> None:
    with pytest.raises(ProductError, match="limit"):
        acquire_product(PROJECT_DIR, max_bytes=1)


def test_source_allowlist_matches_scheme_host_port_and_path() -> None:
    allowed = ["https://api.gdc.cancer.gov/data/"]
    assert _source_allowed("https://api.gdc.cancer.gov/data/file-id", allowed)
    assert not _source_allowed("https://api.gdc.cancer.gov/files/file-id", allowed)
    assert not _source_allowed("http://api.gdc.cancer.gov/data/file-id", allowed)


def test_acquisition_downloads_verifies_and_reuses_asset(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = b"verified fixture"
    destination = _write_acquisition_contracts(tmp_path, payload)
    monkeypatch.setattr(
        acquisition,
        "urlopen",
        lambda _request, **_kwargs: io.BytesIO(payload),
    )

    assert acquire_product(tmp_path) == 1
    assert destination.read_bytes() == payload

    monkeypatch.setattr(
        acquisition,
        "urlopen",
        lambda _request, **_kwargs: pytest.fail("cached asset should not be downloaded"),
    )
    assert acquire_product(tmp_path) == 0


def test_acquisition_rejects_non_allowlisted_source(tmp_path: Path) -> None:
    _write_acquisition_contracts(
        tmp_path,
        b"fixture",
        source_url="https://attacker.example/data/asset.bin",
    )

    with pytest.raises(ProductError, match="not allowlisted"):
        acquire_product(tmp_path)


def test_acquisition_removes_corrupt_partial_download(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = b"corrupt fixture"
    destination = _write_acquisition_contracts(
        tmp_path,
        payload,
        sha256=hashlib.sha256(b"expected fixture").hexdigest(),
    )
    monkeypatch.setattr(
        acquisition,
        "urlopen",
        lambda _request, **_kwargs: io.BytesIO(payload),
    )

    with pytest.raises(ProductError, match="downloaded asset differs"):
        acquire_product(tmp_path)

    assert not destination.exists()
    assert not destination.with_name(f".{destination.name}.part").exists()
