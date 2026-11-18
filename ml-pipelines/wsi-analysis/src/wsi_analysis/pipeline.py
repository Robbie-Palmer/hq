from pathlib import Path

import yaml
from pathologize_tiler import build_pyramid, extract_tiles

from wsi_analysis.config import PROJECT_DIR, PipelineSettings
from wsi_analysis.models import PipelineParameters


def load_pipeline_parameters(path: Path) -> PipelineParameters:
    return PipelineParameters.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))


def prepare_tiles(
    parameters_path: Path,
    *,
    settings: PipelineSettings,
    project_dir: Path = PROJECT_DIR,
) -> tuple[int, int, Path]:
    parameters = load_pipeline_parameters(parameters_path).tiling
    slide = project_dir / parameters.slide
    output = project_dir / parameters.output
    extracted = extract_tiles(
        slide,
        output,
        tile_size=parameters.tile_size,
        batch_size=parameters.batch_size,
        workers=settings.workers,
    )
    pyramidal = build_pyramid(
        output / "0",
        output / "pyramid",
        workers=settings.workers,
    )
    return extracted, pyramidal, output
