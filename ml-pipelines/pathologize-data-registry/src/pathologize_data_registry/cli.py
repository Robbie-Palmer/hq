from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from pathologize_data_registry.acquisition import acquire_asset
from pathologize_data_registry.repository import (
    PROJECT_DIR,
    RegistryValidationError,
    require_valid_registry,
)
from pathologize_data_registry.schemas import SchemaDriftError, write_schemas


class RegistryApplication:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root is not None else PROJECT_DIR

    def validate(self, require_assets: bool = False) -> None:
        registry = require_valid_registry(self.root, require_assets=require_assets)
        print(
            f"Valid registry: {len(registry.collections)} collections, "
            f"{len(registry.subsets)} acquired subset, {len(registry.slides)} slide."
        )

    def acquire(
        self,
        subset: str = "cptac-coad-idc-v7-smallest-series",
        max_bytes: int = 50_000_000,
    ) -> None:
        registry = require_valid_registry(self.root)
        subset_manifest = registry.subsets.get(subset)
        if subset_manifest is None:
            raise RegistryValidationError(f"unknown subset {subset}")
        collection = registry.collections[subset_manifest.collection_id]
        if collection.access.acquisition_policy != "automated_bounded":
            raise RegistryValidationError(f"subset {subset} does not permit automated acquisition")
        if subset_manifest.total_bytes > max_bytes:
            raise RegistryValidationError(
                f"subset {subset} is {subset_manifest.total_bytes} bytes, above limit {max_bytes}"
            )
        asset_manifest = registry.asset_manifests[subset_manifest.asset_manifest_id]
        destination_root = self.root / subset_manifest.asset_root
        downloaded = 0
        reused = 0
        for asset in asset_manifest.assets:
            if acquire_asset(asset, destination_root / asset.relative_path):
                downloaded += 1
            else:
                reused += 1
        require_valid_registry(self.root, require_assets=True)
        print(
            f"Verified {subset_manifest.total_bytes} bytes in {subset_manifest.asset_count} files "
            f"for {subset}: downloaded {downloaded}, reused {reused}."
        )

    def schemas(self, check: bool = False) -> None:
        paths = write_schemas(self.root / "schemas", check=check)
        action = "Checked" if check else "Wrote"
        print(f"{action} {len(paths)} registry schemas.")


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(RegistryApplication, command=list(command) if command is not None else None)
    except (OSError, RegistryValidationError, SchemaDriftError, ValidationError) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
