from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from PIL import Image
from pydicom.errors import InvalidDicomError

from pathologize_tiler.dicom import DicomSlide


class FakeDecoder:
    pass


class FakeDataset:
    frame_count = 4

    @staticmethod
    def as_dataset() -> SimpleNamespace:
        return SimpleNamespace(DimensionOrganizationType="TILED_FULL")


class FakeImageData:
    transfer_syntax = "1.2.840.10008.1.2.4.91"
    photometric_interpretation = "YBR_ICT"
    decoder = FakeDecoder()


class FakeLevel:
    def __init__(self, logical_level: int = 0) -> None:
        self.level = logical_level
        self.size = SimpleNamespace(width=4, height=3)
        self.tile_size = SimpleNamespace(width=2, height=2)
        self.mpp = SimpleNamespace(width=0.5, height=0.75)
        self.default_instance = SimpleNamespace(
            dataset=FakeDataset(),
            image_data=FakeImageData(),
        )


class FakeSlide:
    def __init__(
        self,
        levels: list[FakeLevel] | None = None,
        associated_uids: tuple[str, ...] = (),
    ) -> None:
        self.levels = levels or [FakeLevel()]
        self.labels = _associated_series(associated_uids)
        self.overviews = None
        self.pyramid = SimpleNamespace(thumbnails=None)
        self.closed = False

    def close(self) -> None:
        self.closed = True

    def read_encoded_tile(
        self,
        _level: int,
        coordinate: tuple[int, int],
        *,
        crop_to_image_boundary: bool,
    ) -> bytes:
        assert not crop_to_image_boundary
        return b"encoded" if coordinate != (1, 1) else b""

    def read_tile(self, _level: int, _coordinate: tuple[int, int]) -> Image.Image:
        return Image.new("RGB", (2, 2), (12, 34, 56))


def _associated_series(uids: tuple[str, ...]) -> SimpleNamespace | None:
    if not uids:
        return None
    instances = [
        SimpleNamespace(
            datasets=[
                SimpleNamespace(as_dataset=lambda uid=uid: SimpleNamespace(SOPInstanceUID=uid))
            ]
        )
        for uid in uids
    ]
    return SimpleNamespace(instances=instances)


def _header(role: str, sop_instance_uid: str) -> SimpleNamespace:
    return SimpleNamespace(
        SOPInstanceUID=sop_instance_uid,
        ImageType=("DERIVED", "PRIMARY", role.upper(), "NONE"),
        Columns=2,
        Rows=3,
        file_meta=SimpleNamespace(TransferSyntaxUID="1.2.840.10008.1.2.1"),
        PhotometricInterpretation="RGB",
    )


def test_dicom_slide_exposes_metadata_frames_and_host_tiles(tmp_path: Path) -> None:
    volume = tmp_path / "volume.dcm"
    label = tmp_path / "label.dcm"
    volume.touch()
    label.touch()
    fake = FakeSlide(associated_uids=("label",))

    with (
        patch("pathologize_tiler.dicom.WsiDicom.open", return_value=fake),
        patch(
            "pathologize_tiler.dicom.dcmread",
            side_effect=lambda path, **_kwargs: _header(
                "label" if path == label else "volume", path.stem
            ),
        ),
        DicomSlide.open(tmp_path) as slide,
    ):
        metadata = slide.metadata
        frame = slide.read_encoded_frame(0, (1, 0))
        tile = slide.read_host_tile(0, (0, 0))

    assert fake.closed
    assert metadata.levels[0].microns_per_pixel == (0.5, 0.75)
    assert metadata.levels[0].decoder == "FakeDecoder"
    assert metadata.associated_images[0].role == "label"
    assert frame.frame_index == 1
    assert frame.matrix_position == (2, 0)
    assert frame.dicom_matrix_position == (3, 1)
    assert frame.payload == b"encoded"
    assert tile.image.getpixel((0, 0)) == (12, 34, 56)
    tile.image.close()


def test_dicom_slide_forwards_cache_sizes(tmp_path: Path) -> None:
    source = tmp_path / "slide.dcm"
    source.touch()
    fake = FakeSlide()

    with patch("pathologize_tiler.dicom.WsiDicom.open", return_value=fake) as open_slide:
        slide = DicomSlide.open(
            source,
            decoded_frame_cache_size=0,
            encoded_frame_cache_size=4096,
        )

    settings = open_slide.call_args.kwargs["settings"]
    assert settings.decoded_frame_cache_size == 0
    assert settings.encoded_frame_cache_size == 4096
    slide.close()

    with pytest.raises(ValueError, match="cache sizes must be non-negative"):
        DicomSlide.open(source, decoded_frame_cache_size=-1)


def test_associated_images_are_limited_to_selected_slide_instances(
    tmp_path: Path,
) -> None:
    selected = tmp_path / "selected.dcm"
    foreign = tmp_path / "foreign.dcm"
    report = tmp_path / "report.dcm"
    invalid = tmp_path / "invalid.dcm"
    for path in (selected, foreign, report, invalid):
        path.touch()
    fake = FakeSlide(associated_uids=("selected", "report"))

    def read_header(path: Path, **_kwargs: object) -> SimpleNamespace:
        if path == invalid:
            raise InvalidDicomError
        if path == report:
            return SimpleNamespace(SOPInstanceUID="report")
        return _header("label", path.stem)

    with (
        patch("pathologize_tiler.dicom.WsiDicom.open", return_value=fake),
        patch("pathologize_tiler.dicom.dcmread", side_effect=read_header),
        DicomSlide.open(tmp_path) as slide,
    ):
        associated_images = slide.metadata.associated_images

    assert len(associated_images) == 1
    assert associated_images[0].source_path == selected


def test_associated_image_without_image_type_uses_unknown_role(tmp_path: Path) -> None:
    source = tmp_path / "associated.dcm"
    source.touch()
    fake = FakeSlide(associated_uids=("associated",))
    header = _header("label", "associated")
    del header.ImageType

    with (
        patch("pathologize_tiler.dicom.WsiDicom.open", return_value=fake),
        patch("pathologize_tiler.dicom.dcmread", return_value=header),
        DicomSlide.open(tmp_path) as slide,
    ):
        associated_images = slide.metadata.associated_images

    assert associated_images[0].role == "unknown"


def test_dicom_slide_validates_paths_levels_coordinates_and_payloads(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="DICOM source does not exist"):
        DicomSlide.open(tmp_path / "missing")

    source = tmp_path / "slide.dcm"
    source.touch()
    fake = FakeSlide([FakeLevel(0), FakeLevel(2)])
    with patch("pathologize_tiler.dicom.WsiDicom.open", return_value=fake):
        slide = DicomSlide.open(source)

    with pytest.raises(ValueError, match="logical level 1 is absent; available: 0, 2"):
        slide.read_encoded_frame(1, (0, 0))
    with pytest.raises(ValueError, match="must be non-negative"):
        slide.read_encoded_frame(0, (-1, 0))
    with pytest.raises(ValueError, match="outside 2x2 grid"):
        slide.read_host_tile(0, (2, 0))
    with pytest.raises(ValueError, match="empty encoded frame"):
        slide.read_encoded_frame(0, (1, 1))


def test_sparse_dicom_frame_does_not_invent_frame_index(tmp_path: Path) -> None:
    source = tmp_path / "slide.dcm"
    source.touch()
    level = FakeLevel()
    level.default_instance.dataset.as_dataset = lambda: SimpleNamespace(
        DimensionOrganizationType="TILED_SPARSE"
    )
    fake = FakeSlide([level])
    with patch("pathologize_tiler.dicom.WsiDicom.open", return_value=fake):
        slide = DicomSlide.open(source)
        frame = slide.read_encoded_frame(0, (0, 0))

    assert frame.frame_index is None
