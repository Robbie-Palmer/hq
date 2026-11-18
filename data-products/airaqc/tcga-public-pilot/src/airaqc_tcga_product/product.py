from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any, cast

from airaqc_tcga_product.models import Asset, AssetManifest, Collection, Corpus, Slide, Subset

PROJECT_DIR = Path(__file__).resolve().parents[2]
NATIVE_LABELS = {"air_bubble", "fold", "out_of_focus", "penmark"}


class ProductError(RuntimeError):
    pass


def _read_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ProductError(f"{path} must contain a JSON object")
    return cast(dict[str, Any], payload)


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _require_product_identity(
    collection: Collection, subset: Subset, assets: AssetManifest, corpus: Corpus
) -> None:
    if subset.collection_id != collection.collection_id:
        raise ProductError("subset and collection identifiers differ")
    if assets.asset_manifest_id != subset.asset_manifest_id or assets.subset_id != subset.subset_id:
        raise ProductError("asset manifest does not belong to the declared subset")
    if corpus.corpus_id != subset.subset_id:
        raise ProductError("corpus and subset identifiers differ")
    if len(assets.assets) != subset.asset_count:
        raise ProductError("asset count differs from the subset contract")
    if sum(asset.bytes for asset in assets.assets) != subset.total_bytes:
        raise ProductError("asset bytes differ from the subset contract")


def _asset_index(assets: AssetManifest) -> dict[str, Asset]:
    assets_by_path = {asset.relative_path: asset for asset in assets.assets}
    if len(assets_by_path) != len(assets.assets):
        raise ProductError("asset paths must be unique")
    return assets_by_path


def _validate_slides(
    corpus: Corpus, subset: Subset, assets_by_path: dict[str, Asset]
) -> Counter[str]:
    slide_ids = [slide.slide_id for slide in corpus.slides]
    patient_ids = [slide.patient_id for slide in corpus.slides]
    if set(slide_ids) != set(subset.slide_ids):
        raise ProductError("corpus slides differ from the fixed subset")
    if len(slide_ids) != len(set(slide_ids)) or len(patient_ids) != len(set(patient_ids)):
        raise ProductError("slide and patient identities must be unique")

    label_pixels: Counter[str] = Counter()
    for slide in corpus.slides:
        _validate_slide(slide, assets_by_path, label_pixels)
    return label_pixels


def _validate_slide(
    slide: Slide, assets_by_path: dict[str, Asset], label_pixels: Counter[str]
) -> None:
    if set(slide.annotation_counts) != NATIVE_LABELS:
        raise ProductError(f"{slide.slide_id}: native annotation labels differ")
    label_pixels.update(slide.annotation_counts)
    for corpus_asset in (slide.source, slide.annotation):
        declared = assets_by_path.get(corpus_asset.relative_path)
        if declared is None:
            raise ProductError(f"{slide.slide_id}: undeclared asset {corpus_asset.relative_path}")
        if declared.bytes != corpus_asset.bytes or declared.sha256 != corpus_asset.sha256:
            raise ProductError(f"{slide.slide_id}: asset identity differs from its manifest")


def _validate_contracts(root: Path) -> tuple[dict[str, Any], dict[str, object]]:
    collection = Collection.model_validate(_read_object(root / "contracts/collection.json"))
    subset = Subset.model_validate(_read_object(root / "contracts/subset.json"))
    assets = AssetManifest.model_validate(_read_object(root / "contracts/assets.json"))
    corpus_payload = _read_object(root / "records/native-corpus.json")
    corpus = Corpus.model_validate(corpus_payload)
    _require_product_identity(collection, subset, assets, corpus)
    label_pixels = _validate_slides(corpus, subset, _asset_index(assets))
    patient_ids = {slide.patient_id for slide in corpus.slides}

    metrics: dict[str, object] = {
        "asset_count": len(assets.assets),
        "patient_count": len(patient_ids),
        "raw_bytes": subset.total_bytes,
        "slide_count": len(corpus.slides),
        "source_dataset_id": subset.subset_id,
        "native_label_pixels": dict(sorted(label_pixels.items())),
    }
    return corpus_payload, metrics


def publish_product(root: Path = PROJECT_DIR) -> dict[str, object]:
    corpus, metrics = _validate_contracts(root)
    _write_json(root / "outputs/native-corpus.json", corpus)
    _write_json(root / "outputs/metrics.json", metrics)
    return metrics
