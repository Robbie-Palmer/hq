from pathlib import Path
from types import TracebackType
from typing import ClassVar, Self, override
from unittest.mock import patch

import pytest
from PIL import Image
from pytest_cases import fixture, fixture_union, parametrize_with_cases

from pathologize_tiler.tiling import (
    PhysicalTileRequest,
    ScaleMetadataError,
    SourceScale,
    batched,
    build_pyramid,
    extract_tiles,
    inspect_slide,
    plan_batches,
    read_physical_tile,
    read_raster_physical_tile,
)


class FakeSlide:
    properties: ClassVar[dict[str, str]] = {}
    level_dimensions = ((4, 4), (2, 2))
    level_downsamples = (1.0, 2.0)

    def __init__(self, _path: Path) -> None:
        pass

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        _exc_type: type[BaseException] | None,
        _exc_value: BaseException | None,
        _traceback: TracebackType | None,
    ) -> None:
        pass

    def read_region(
        self, _location: tuple[int, int], _level: int, size: tuple[int, int]
    ) -> Image.Image:
        return Image.new("RGBA", size)


class VendorTiledSlide(FakeSlide):
    properties: ClassVar[dict[str, str]] = {
        "openslide.level[0].tile-width": "4",
        "openslide.level[0].tile-height": "4",
    }


class PhysicalSlide(FakeSlide):
    properties: ClassVar[dict[str, str]] = {
        "openslide.mpp-x": "0.5",
        "openslide.mpp-y": "0.5",
        "openslide.vendor": "fixture",
    }
    level_dimensions = ((64, 64), (32, 32), (16, 16))
    level_downsamples = (1.0, 2.0, 4.0)
    last_read: ClassVar[tuple[tuple[int, int], int, tuple[int, int]] | None] = None

    @override
    def read_region(
        self, _location: tuple[int, int], _level: int, size: tuple[int, int]
    ) -> Image.Image:
        type(self).last_read = (_location, _level, size)
        return Image.new("RGBA", size, (120, 80, 40, 255))


type SlidePlan = tuple[type[FakeSlide], tuple[int, int], int]


@fixture
def fallback_slide_plan() -> SlidePlan:
    return FakeSlide, (2, 2), 3


@fixture
def vendor_slide_plan() -> SlidePlan:
    return VendorTiledSlide, (4, 4), 2


slide_plan = fixture_union("slide_plan", [fallback_slide_plan, vendor_slide_plan])


def _image_dimensions(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        return image.size


def test_batched_preserves_order_and_remainder() -> None:
    assert list(batched([1, 2, 3, 4, 5], 2)) == [(1, 2), (3, 4), (5,)]


@parametrize_with_cases("source,expected_counts,expected_dimensions", prefix="pyramid_")
def test_build_pyramid_is_resumable(
    source: Path,
    expected_counts: dict[int, int],
    expected_dimensions: tuple[int, int],
) -> None:
    output = source.parent / "pyramid"

    first_count = build_pyramid(source, output, workers=2)
    second_count = build_pyramid(source, output, workers=2)

    actual_counts = {
        int(level.name): len(list(level.glob("*.png")))
        for level in output.iterdir()
        if level.is_dir()
    }
    assert first_count == sum(expected_counts.values())
    assert second_count == 0
    assert actual_counts == expected_counts
    assert not list(output.rglob("*.tmp"))
    assert {_image_dimensions(path) for path in output.rglob("*.png")} == {expected_dimensions}


def test_plan_batches_supports_fallback_and_vendor_tiles(
    tmp_path: Path, slide_plan: SlidePlan
) -> None:
    slide = tmp_path / "slide.dcm"
    slide.write_bytes(b"fixture")
    slide_class, expected_tile_size, expected_batch_count = slide_plan

    with patch("pathologize_tiler.tiling.OpenSlide", slide_class):
        batches = plan_batches(slide, tmp_path / "tiles", tile_size=2, batch_size=3)

    assert len(batches) == expected_batch_count
    assert batches[0].tile_size == expected_tile_size
    assert batches[-1].downsample == 2.0


def test_extract_tiles_writes_atomically_and_resumes(tmp_path: Path) -> None:
    slide = tmp_path / "slide.dcm"
    output = tmp_path / "tiles"
    slide.write_bytes(b"fixture")

    with patch("pathologize_tiler.tiling.OpenSlide", FakeSlide):
        first_count = extract_tiles(slide, output, tile_size=2, batch_size=2, workers=2)
        second_count = extract_tiles(slide, output, tile_size=2, batch_size=2, workers=2)

    assert first_count == 5
    assert second_count == 0
    assert len(list(output.rglob("*.png"))) == 5
    assert list(output.rglob("*.tmp")) == []


def test_extract_tiles_rejects_missing_slide(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="Slide does not exist"):
        extract_tiles(
            tmp_path / "missing.dcm",
            tmp_path / "tiles",
            tile_size=2,
            batch_size=2,
            workers=1,
        )


@pytest.mark.parametrize(
    ("source_scale", "expected_size"),
    [
        (SourceScale(0.5, 0.5, 1.0), (16, 18)),
        (SourceScale(0.5, 0.75, 1.0), (16, 12)),
        (SourceScale(0.5, 0.5, 1.0), (16, 18)),
        (SourceScale(0.5, 0.5, 4.0), (4, 4)),
    ],
)
def test_read_physical_tile_uses_each_scale_axis_and_level(
    tmp_path: Path,
    source_scale: SourceScale,
    expected_size: tuple[int, int],
) -> None:
    slide = tmp_path / "slide.dcm"
    slide.write_bytes(b"fixture")
    request = PhysicalTileRequest(
        location_level_zero=(8, 12),
        level=2 if source_scale.level_downsample == 4.0 else 0,
        output_size=(16, 18),
        target_microns_per_pixel=(0.5, 0.5),
    )

    with patch("pathologize_tiler.tiling.OpenSlide", PhysicalSlide):
        tile = read_physical_tile(slide, request, source_scale=source_scale)

    assert tile.source_size == expected_size
    assert tile.image.size == (16, 18)
    assert tile.decoded_bytes_read == expected_size[0] * expected_size[1] * 4
    assert PhysicalSlide.last_read == ((8, 12), request.level, expected_size)
    tile.image.close()


@pytest.mark.parametrize(
    ("source_scale", "code"),
    [
        (SourceScale(None, None, 1.0), "missing_mpp"),
        (SourceScale(0.001, 0.5, 1.0), "implausible_mpp"),
    ],
)
def test_read_physical_tile_rejects_unusable_metadata(
    tmp_path: Path, source_scale: SourceScale, code: str
) -> None:
    slide = tmp_path / "slide.dcm"
    slide.write_bytes(b"fixture")
    request = PhysicalTileRequest(
        location_level_zero=(0, 0),
        level=0,
        output_size=(16, 18),
        target_microns_per_pixel=(0.5, 0.5),
    )

    with (
        patch("pathologize_tiler.tiling.OpenSlide", PhysicalSlide),
        pytest.raises(ScaleMetadataError) as raised,
    ):
        read_physical_tile(slide, request, source_scale=source_scale)

    assert raised.value.code == code


def test_wrong_level_metadata_changes_the_region_read(tmp_path: Path) -> None:
    slide = tmp_path / "slide.dcm"
    slide.write_bytes(b"fixture")
    request = PhysicalTileRequest(
        location_level_zero=(0, 0),
        level=2,
        output_size=(16, 18),
        target_microns_per_pixel=(0.5, 0.5),
    )

    with patch("pathologize_tiler.tiling.OpenSlide", PhysicalSlide):
        wrong = read_physical_tile(
            slide,
            request,
            source_scale=SourceScale(0.5, 0.5, 1.0),
        )
        correct = read_physical_tile(slide, request)

    assert wrong.source_size == (16, 18)
    assert correct.source_size == (4, 4)
    wrong.image.close()
    correct.image.close()


def test_inspect_slide_reports_reader_metadata(tmp_path: Path) -> None:
    slide = tmp_path / "slide.dcm"
    slide.write_bytes(b"fixture")

    with patch("pathologize_tiler.tiling.OpenSlide", PhysicalSlide):
        metadata = inspect_slide(slide)

    assert metadata.level_dimensions == ((64, 64), (32, 32), (16, 16))
    assert metadata.level_downsamples == (1.0, 2.0, 4.0)
    assert metadata.microns_per_pixel_x == 0.5
    assert metadata.microns_per_pixel_y == 0.5
    assert metadata.vendor == "fixture"


def test_read_raster_physical_tile_uses_real_pixels(tmp_path: Path) -> None:
    image_path = tmp_path / "region.png"
    Image.new("RGB", (32, 24), (12, 34, 56)).save(image_path)
    request = PhysicalTileRequest(
        location_level_zero=(0, 0),
        level=0,
        output_size=(8, 6),
        target_microns_per_pixel=(1.0, 1.0),
    )

    tile = read_raster_physical_tile(
        image_path,
        request,
        source_scale=SourceScale(0.5, 0.5, 1.0),
    )

    assert tile.source_size == (16, 12)
    assert tile.image.size == (8, 6)
    tile.image.close()


def test_slide_and_raster_reads_reject_missing_paths(tmp_path: Path) -> None:
    request = PhysicalTileRequest(
        location_level_zero=(0, 0),
        level=0,
        output_size=(8, 6),
        target_microns_per_pixel=(1.0, 1.0),
    )
    with pytest.raises(FileNotFoundError, match="Slide does not exist"):
        read_physical_tile(tmp_path / "missing.dcm", request)
    with pytest.raises(FileNotFoundError, match="Image does not exist"):
        read_raster_physical_tile(
            tmp_path / "missing.png",
            request,
            source_scale=SourceScale(0.5, 0.5, 1.0),
        )
    with pytest.raises(FileNotFoundError, match="Slide does not exist"):
        inspect_slide(tmp_path / "missing.dcm")
