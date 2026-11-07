from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pathologize_tiler import extract_tiles
from pydantic import ValidationError

from wsi_analysis.config import PROJECT_DIR, PipelineSettings
from wsi_analysis.dataset import (
    build_inventory,
    load_dataset_card,
    validate_inventory,
    validate_pngs,
    write_inventory,
)
from wsi_analysis.models import DatasetInventory
from wsi_analysis.pipeline import prepare_tiles


class DatasetValidationError(RuntimeError):
    pass


class WsiAnalysis:
    def __init__(self) -> None:
        self.settings = PipelineSettings()

    def _inventory(self) -> DatasetInventory:
        card = load_dataset_card(self.settings.dataset_card)
        return build_inventory(card, self.settings.data_dir)

    def inventory(self, output: str | None = None) -> None:
        output_path = Path(output) if output else self.settings.inventory_path
        write_inventory(self._inventory(), output_path)
        print(f"Wrote {output_path}")

    def validate(self, verify_images: bool = False) -> None:
        issues = validate_inventory(self._inventory())
        if verify_images:
            issues.extend(validate_pngs(self.settings.tile_dir))
        if issues:
            message = "\n".join(f"{issue.path}: {issue.message}" for issue in issues)
            raise DatasetValidationError(message)
        print("Dataset metadata and local files are valid.")

    def tile(self, slide: str, output: str, overwrite: bool = False) -> None:
        slide_path = Path(slide)
        output_path = Path(output)
        written = extract_tiles(
            slide_path,
            output_path,
            tile_size=self.settings.tile_size,
            batch_size=self.settings.batch_size,
            workers=self.settings.workers,
            overwrite=overwrite,
        )
        print(f"Wrote {written} tiles to {output_path}")

    def prepare(self, parameters: str = "params.yaml") -> None:
        parameters_path = Path(parameters)
        if not parameters_path.is_absolute():
            parameters_path = PROJECT_DIR / parameters_path
        extracted, pyramidal, output = prepare_tiles(
            parameters_path,
            settings=self.settings,
        )
        print(f"Wrote {extracted} native tiles and {pyramidal} pyramid tiles to {output}")


def main(command: Sequence[str] | None = None) -> int:
    try:
        application = WsiAnalysis()
        fire_command = list(command) if command is not None else None
        fire.Fire(
            {
                "inventory": application.inventory,
                "prepare": application.prepare,
                "tile": application.tile,
                "validate": application.validate,
            },
            command=fire_command,
            name="wsi-analysis",
        )
    except DatasetValidationError as error:
        print(error)
        return 1
    except (OSError, ValidationError) as error:
        print(f"Configuration error: {error}")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
