from __future__ import annotations

import math
import os
import shutil
from collections.abc import Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

from openslide import AbstractSlide, ImageSlide, OpenSlide
from PIL import Image

_TEMPORARY_SUFFIX = ".png.tmp"


@dataclass(frozen=True, slots=True)
class TileBatch:
    coordinates: tuple[tuple[int, int], ...]
    level: int
    tile_size: tuple[int, int]
    downsample: float
    output_dir: Path


@dataclass(frozen=True, slots=True)
class SourceScale:
    microns_per_pixel_x: float | None
    microns_per_pixel_y: float | None
    level_downsample: float


@dataclass(frozen=True, slots=True)
class PhysicalTileRequest:
    location_level_zero: tuple[int, int]
    level: int
    output_size: tuple[int, int]
    target_microns_per_pixel: tuple[float, float]


@dataclass(frozen=True, slots=True)
class SlideMetadata:
    level_dimensions: tuple[tuple[int, int], ...]
    level_downsamples: tuple[float, ...]
    microns_per_pixel_x: float | None
    microns_per_pixel_y: float | None
    vendor: str | None


@dataclass(frozen=True, slots=True)
class PhysicalTileRead:
    image: Image.Image
    level: int
    source_size: tuple[int, int]
    output_size: tuple[int, int]
    presented_microns_per_pixel: tuple[float, float]
    presented_level_downsample: float
    decoded_bytes_read: int


class ScaleMetadataError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _optional_float(value: str | None) -> float | None:
    return float(value) if value is not None else None


def inspect_slide(slide_path: Path) -> SlideMetadata:
    if not slide_path.is_file():
        msg = f"Slide does not exist: {slide_path}"
        raise FileNotFoundError(msg)
    with OpenSlide(slide_path) as slide:
        return SlideMetadata(
            level_dimensions=tuple(slide.level_dimensions),
            level_downsamples=tuple(float(value) for value in slide.level_downsamples),
            microns_per_pixel_x=_optional_float(slide.properties.get("openslide.mpp-x")),
            microns_per_pixel_y=_optional_float(slide.properties.get("openslide.mpp-y")),
            vendor=slide.properties.get("openslide.vendor"),
        )


def _validate_request(request: PhysicalTileRequest, level_count: int) -> None:
    if request.level < 0 or request.level >= level_count:
        raise ValueError(f"level {request.level} is outside the slide pyramid")
    if any(value < 0 for value in request.location_level_zero):
        raise ValueError("tile location must be non-negative")
    if any(value <= 0 for value in request.output_size):
        raise ValueError("output dimensions must be positive")
    if any(not math.isfinite(value) or value <= 0 for value in request.target_microns_per_pixel):
        raise ValueError("target MPP must be finite and positive")


def _source_scale(slide: AbstractSlide, level: int, override: SourceScale | None) -> SourceScale:
    if override is not None:
        return override
    return SourceScale(
        microns_per_pixel_x=_optional_float(slide.properties.get("openslide.mpp-x")),
        microns_per_pixel_y=_optional_float(slide.properties.get("openslide.mpp-y")),
        level_downsample=float(slide.level_downsamples[level]),
    )


def _validated_effective_scale(
    scale: SourceScale,
    *,
    plausible_mpp: tuple[float, float],
) -> tuple[float, float]:
    if scale.microns_per_pixel_x is None or scale.microns_per_pixel_y is None:
        raise ScaleMetadataError("missing_mpp", "both source MPP axes are required")
    minimum, maximum = plausible_mpp
    if minimum <= 0 or minimum >= maximum:
        raise ValueError("plausible MPP bounds must be positive and ordered")
    for axis, value in (
        ("x", scale.microns_per_pixel_x),
        ("y", scale.microns_per_pixel_y),
    ):
        if not math.isfinite(value) or value < minimum or value > maximum:
            raise ScaleMetadataError(
                "implausible_mpp",
                f"source MPP {axis}={value} is outside [{minimum}, {maximum}]",
            )
    if not math.isfinite(scale.level_downsample) or scale.level_downsample <= 0:
        raise ScaleMetadataError(
            "implausible_downsample", "level downsample must be finite and positive"
        )
    return (
        scale.microns_per_pixel_x * scale.level_downsample,
        scale.microns_per_pixel_y * scale.level_downsample,
    )


def _read_physical_tile(
    slide: AbstractSlide,
    request: PhysicalTileRequest,
    *,
    source_scale: SourceScale | None = None,
    plausible_mpp: tuple[float, float] = (0.05, 10.0),
) -> PhysicalTileRead:
    _validate_request(request, len(slide.level_dimensions))
    presented = _source_scale(slide, request.level, source_scale)
    effective_x, effective_y = _validated_effective_scale(presented, plausible_mpp=plausible_mpp)
    physical_width = request.output_size[0] * request.target_microns_per_pixel[0]
    physical_height = request.output_size[1] * request.target_microns_per_pixel[1]
    source_size = (
        max(1, round(physical_width / effective_x)),
        max(1, round(physical_height / effective_y)),
    )
    with slide.read_region(request.location_level_zero, request.level, source_size) as region:
        converted = region.convert("RGB")
    if converted.size == request.output_size:
        image = converted
    else:
        image = converted.resize(request.output_size, Image.Resampling.LANCZOS)
        converted.close()
    return PhysicalTileRead(
        image=image,
        level=request.level,
        source_size=source_size,
        output_size=request.output_size,
        presented_microns_per_pixel=(effective_x, effective_y),
        presented_level_downsample=presented.level_downsample,
        decoded_bytes_read=source_size[0] * source_size[1] * 4,
    )


def read_physical_tile(
    slide_path: Path,
    request: PhysicalTileRequest,
    *,
    source_scale: SourceScale | None = None,
    plausible_mpp: tuple[float, float] = (0.05, 10.0),
) -> PhysicalTileRead:
    if not slide_path.is_file():
        msg = f"Slide does not exist: {slide_path}"
        raise FileNotFoundError(msg)
    with OpenSlide(slide_path) as slide:
        return _read_physical_tile(
            slide,
            request,
            source_scale=source_scale,
            plausible_mpp=plausible_mpp,
        )


def read_raster_physical_tile(
    image_path: Path,
    request: PhysicalTileRequest,
    *,
    source_scale: SourceScale,
    plausible_mpp: tuple[float, float] = (0.05, 10.0),
) -> PhysicalTileRead:
    if not image_path.is_file():
        msg = f"Image does not exist: {image_path}"
        raise FileNotFoundError(msg)
    with ImageSlide(image_path) as slide:
        return _read_physical_tile(
            slide,
            request,
            source_scale=source_scale,
            plausible_mpp=plausible_mpp,
        )


def batched[T](items: Sequence[T], size: int) -> Iterable[tuple[T, ...]]:
    for offset in range(0, len(items), size):
        yield tuple(items[offset : offset + size])


def _tile_dimensions(slide: OpenSlide, level: int, fallback: int) -> tuple[int, int]:
    width = slide.properties.get(f"openslide.level[{level}].tile-width")
    height = slide.properties.get(f"openslide.level[{level}].tile-height")
    if width is None or height is None:
        return fallback, fallback
    return int(width), int(height)


def plan_batches(
    slide_path: Path, output_dir: Path, *, tile_size: int, batch_size: int
) -> list[TileBatch]:
    batches: list[TileBatch] = []
    with OpenSlide(slide_path) as slide:
        for level, (width, height) in enumerate(slide.level_dimensions):
            dimensions = _tile_dimensions(slide, level, tile_size)
            tile_width, tile_height = dimensions
            coordinates = [
                (x, y) for y in range(0, height, tile_height) for x in range(0, width, tile_width)
            ]
            level_dir = output_dir / str(level)
            batches.extend(
                TileBatch(
                    coordinates=coordinates_batch,
                    level=level,
                    tile_size=dimensions,
                    downsample=float(slide.level_downsamples[level]),
                    output_dir=level_dir,
                )
                for coordinates_batch in batched(coordinates, batch_size)
            )
    return batches


def _extract_batch(slide_path: Path, batch: TileBatch, *, overwrite: bool) -> int:
    batch.output_dir.mkdir(parents=True, exist_ok=True)
    written = 0
    with OpenSlide(slide_path) as slide:
        for x, y in batch.coordinates:
            output_path = batch.output_dir / f"{x}_{y}.png"
            if output_path.exists() and not overwrite:
                continue
            level_zero_location = (
                math.floor(x * batch.downsample),
                math.floor(y * batch.downsample),
            )
            temporary_path = output_path.with_suffix(_TEMPORARY_SUFFIX)
            with slide.read_region(level_zero_location, batch.level, batch.tile_size) as image:
                image.save(temporary_path, format="PNG")
            temporary_path.replace(output_path)
            written += 1
    return written


def _coordinate_tiles(path: Path) -> tuple[dict[tuple[int, int], Path], tuple[int, int]]:
    tiles: dict[tuple[int, int], Path] = {}
    dimensions: tuple[int, int] | None = None
    for tile_path in sorted(path.glob("*.png")):
        try:
            pixel_x, pixel_y = (int(part) for part in tile_path.stem.split("_", maxsplit=1))
        except ValueError:
            continue
        with Image.open(tile_path) as image:
            image_dimensions = image.size
        if dimensions is None:
            dimensions = image_dimensions
        elif image_dimensions != dimensions:
            msg = (
                f"Tile dimensions must be consistent: {tile_path} is {image_dimensions}, "
                f"expected {dimensions}"
            )
            raise ValueError(msg)
        tile_width, tile_height = dimensions
        if pixel_x % tile_width or pixel_y % tile_height:
            msg = f"Tile coordinates must align to {tile_width}x{tile_height}: {tile_path}"
            raise ValueError(msg)
        tiles[pixel_x // tile_width, pixel_y // tile_height] = tile_path
    if not tiles or dimensions is None:
        msg = f"No coordinate-named PNG tiles found in {path}"
        raise ValueError(msg)
    return tiles, dimensions


def _link_tile(source: Path, output: Path) -> bool:
    if output.exists():
        return False
    temporary = output.with_suffix(_TEMPORARY_SUFFIX)
    temporary.unlink(missing_ok=True)
    try:
        os.link(source, temporary)
    except OSError:
        shutil.copyfile(source, temporary)
    temporary.replace(output)
    return True


def _downsample_tile(
    parent: tuple[int, int],
    children: dict[tuple[int, int], Path],
    output_dir: Path,
    tile_dimensions: tuple[int, int],
) -> tuple[tuple[int, int], Path, bool]:
    parent_x, parent_y = parent
    output = output_dir / f"{parent_x}_{parent_y}.png"
    if output.exists():
        return parent, output, False

    tile_width, tile_height = tile_dimensions
    canvas = Image.new("RGBA", (tile_width * 2, tile_height * 2), (0, 0, 0, 0))
    for offset_y in range(2):
        for offset_x in range(2):
            child = children.get((parent_x * 2 + offset_x, parent_y * 2 + offset_y))
            if child is None:
                continue
            with Image.open(child) as image:
                canvas.paste(image, (offset_x * tile_width, offset_y * tile_height))

    temporary = output.with_suffix(_TEMPORARY_SUFFIX)
    temporary.unlink(missing_ok=True)
    with canvas.resize(tile_dimensions, Image.Resampling.LANCZOS) as tile:
        tile.save(temporary, format="PNG")
    temporary.replace(output)
    return parent, output, True


def build_pyramid(
    source_dir: Path,
    output_dir: Path,
    *,
    workers: int,
) -> int:
    source_tiles, tile_dimensions = _coordinate_tiles(source_dir)
    max_dimension = max(max(coordinate) for coordinate in source_tiles) + 1
    maximum_zoom = math.ceil(math.log2(max_dimension))
    high_resolution_dir = output_dir / str(maximum_zoom)
    high_resolution_dir.mkdir(parents=True, exist_ok=True)

    written = 0
    current_tiles: dict[tuple[int, int], Path] = {}
    for coordinate, source in source_tiles.items():
        output = high_resolution_dir / f"{coordinate[0]}_{coordinate[1]}.png"
        written += _link_tile(source, output)
        current_tiles[coordinate] = output

    for zoom in range(maximum_zoom - 1, -1, -1):
        output_level = output_dir / str(zoom)
        output_level.mkdir(parents=True, exist_ok=True)
        parents = sorted({(coordinate[0] // 2, coordinate[1] // 2) for coordinate in current_tiles})
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [
                executor.submit(
                    _downsample_tile,
                    parent,
                    current_tiles,
                    output_level,
                    tile_dimensions,
                )
                for parent in parents
            ]
            results = [future.result() for future in as_completed(futures)]
        current_tiles = {coordinate: path for coordinate, path, _ in results}
        written += sum(created for _, _, created in results)

    return written


def extract_tiles(
    slide_path: Path,
    output_dir: Path,
    *,
    tile_size: int,
    batch_size: int,
    workers: int,
    overwrite: bool = False,
) -> int:
    if not slide_path.is_file():
        msg = f"Slide does not exist: {slide_path}"
        raise FileNotFoundError(msg)

    batches = plan_batches(slide_path, output_dir, tile_size=tile_size, batch_size=batch_size)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [
            executor.submit(_extract_batch, slide_path, batch, overwrite=overwrite)
            for batch in batches
        ]
        return sum(future.result() for future in as_completed(futures))
