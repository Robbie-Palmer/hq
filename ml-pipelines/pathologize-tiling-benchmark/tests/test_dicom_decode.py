from __future__ import annotations

from pathlib import Path

import pytest
from pathologize_tiler import (
    DicomSlide,
    PhysicalTileRequest,
    read_physical_tile,
)
from PIL import ImageChops, ImageStat
from pydantic import BaseModel, ConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = PROJECT_ROOT.parents[1]
FIXTURE_ROOT = (
    REPOSITORY_ROOT
    / "ml-pipelines/pathologize-data-registry/data/raw/cptac-coad-idc/v23"
    / "b117aabf-c225-432e-95af-8ee9247a1ad6"
)
PRIMARY_INSTANCE = FIXTURE_ROOT / "ccc0f1f8-6b8b-474b-9490-a0bbf5b9b5dd.dcm"


class RgbSample(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    position: tuple[int, int]
    value: tuple[int, int, int]


class FrameOracle(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    schema_version: str
    source_instance_sha256: str
    logical_level: int
    tile_coordinate: tuple[int, int]
    frame_index: int
    rgb_samples: list[RgbSample]
    rgb_channel_means: tuple[float, float, float]
    sample_absolute_tolerance: int
    mean_absolute_tolerance: float
    oracle: str


def _oracle() -> FrameOracle:
    return FrameOracle.model_validate_json(
        (PROJECT_ROOT / "fixtures/cptac-dicom-frame-oracle.json").read_text(encoding="utf-8")
    )


def test_dicom_series_exposes_pyramid_frame_and_associated_image_semantics() -> None:
    with DicomSlide.open(FIXTURE_ROOT) as slide:
        metadata = slide.metadata
        frame = slide.read_encoded_frame(0, (28, 28))

    assert [level.pyramid_index for level in metadata.levels] == [0, 1, 2]
    assert [level.logical_level for level in metadata.levels] == [0, 2, 3]
    assert [level.dimensions for level in metadata.levels] == [
        (14400, 14770),
        (3600, 3692),
        (1800, 1846),
    ]
    assert [level.microns_per_pixel for level in metadata.levels] == [
        pytest.approx((0.2501, 0.2501)),
        pytest.approx((1.0004, 1.0004)),
        pytest.approx((2.0008, 2.0008)),
    ]
    assert {image.role for image in metadata.associated_images} == {
        "label",
        "overview",
        "thumbnail",
    }
    assert frame.frame_index == 1624
    assert frame.matrix_position == (7168, 7168)
    assert frame.dicom_matrix_position == (7169, 7169)
    assert frame.transfer_syntax_uid == "1.2.840.10008.1.2.4.91"
    assert frame.photometric_interpretation == "YBR_ICT"
    assert frame.dimension_organization_type == "TILED_FULL"
    assert frame.payload.startswith(b"\xff\x4f")


def test_correct_cpu_dicom_decode_matches_oracle_and_rejects_openslide_color() -> None:
    oracle = _oracle()
    coordinate = oracle.tile_coordinate
    with DicomSlide.open(FIXTURE_ROOT) as slide:
        decoded = slide.read_host_tile(oracle.logical_level, coordinate)

    with decoded.image:
        for sample in oracle.rgb_samples:
            actual = decoded.image.getpixel(sample.position)
            assert isinstance(actual, tuple)
            assert all(
                abs(actual_channel - expected_channel) <= oracle.sample_absolute_tolerance
                for actual_channel, expected_channel in zip(actual, sample.value, strict=True)
            )
        assert ImageStat.Stat(decoded.image).mean == pytest.approx(
            oracle.rgb_channel_means,
            abs=oracle.mean_absolute_tolerance,
        )

        request = PhysicalTileRequest(
            location_level_zero=(coordinate[0] * 256, coordinate[1] * 256),
            level=0,
            output_size=(256, 256),
            target_microns_per_pixel=(0.2501, 0.2501),
        )
        openslide = read_physical_tile(PRIMARY_INSTANCE, request)
        with openslide.image:
            difference = ImageStat.Stat(ImageChops.difference(decoded.image, openslide.image))

    assert "OpenJpeg" in decoded.decoder
    assert max(difference.extrema[channel][1] for channel in range(3)) >= 100
    assert sum(difference.mean) / 3 >= 30


def test_dicom_series_fails_closed_for_missing_logical_level() -> None:
    with (
        DicomSlide.open(FIXTURE_ROOT) as slide,
        pytest.raises(ValueError, match="logical level 1 is absent; available: 0, 2, 3"),
    ):
        slide.read_encoded_frame(1, (0, 0))
