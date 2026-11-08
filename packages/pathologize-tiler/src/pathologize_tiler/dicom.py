from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType
from typing import Self

from PIL import Image
from pydicom import dcmread
from pydicom.errors import InvalidDicomError
from wsidicom import WsiDicom
from wsidicom.config import Settings
from wsidicom.group.level import Level


@dataclass(frozen=True, slots=True)
class DicomLevelMetadata:
    pyramid_index: int
    logical_level: int
    dimensions: tuple[int, int]
    tile_size: tuple[int, int]
    microns_per_pixel: tuple[float, float]
    frame_count: int
    transfer_syntax_uid: str
    photometric_interpretation: str
    dimension_organization_type: str
    decoder: str


@dataclass(frozen=True, slots=True)
class DicomAssociatedImage:
    role: str
    dimensions: tuple[int, int]
    transfer_syntax_uid: str
    photometric_interpretation: str
    source_path: Path


@dataclass(frozen=True, slots=True)
class DicomSlideMetadata:
    levels: tuple[DicomLevelMetadata, ...]
    associated_images: tuple[DicomAssociatedImage, ...]


@dataclass(frozen=True, slots=True)
class EncodedDicomFrame:
    payload: bytes
    logical_level: int
    tile_coordinate: tuple[int, int]
    matrix_position: tuple[int, int]
    dicom_matrix_position: tuple[int, int]
    frame_index: int | None
    transfer_syntax_uid: str
    photometric_interpretation: str
    dimension_organization_type: str


@dataclass(frozen=True, slots=True)
class HostDicomTile:
    image: Image.Image
    logical_level: int
    tile_coordinate: tuple[int, int]
    decoder: str


def _series_files(path: Path) -> tuple[Path, ...]:
    if path.is_file():
        return (path,)
    return tuple(sorted(path.glob("*.dcm")))


def _associated_instance_uids(slide: WsiDicom) -> frozenset[str]:
    selected_uids: set[str] = set()
    series = (slide.labels, slide.overviews, slide.pyramid.thumbnails)
    for associated_series in series:
        if associated_series is None:
            continue
        for instance in associated_series.instances:
            for dataset in instance.datasets:
                sop_instance_uid = getattr(dataset.as_dataset(), "SOPInstanceUID", None)
                if sop_instance_uid is not None:
                    selected_uids.add(str(sop_instance_uid))
    return frozenset(selected_uids)


def _associated_images(path: Path, slide: WsiDicom) -> tuple[DicomAssociatedImage, ...]:
    selected_uids = _associated_instance_uids(slide)
    images: list[DicomAssociatedImage] = []
    for source_path in _series_files(path):
        try:
            dataset = dcmread(source_path, stop_before_pixels=True)
        except InvalidDicomError:
            continue
        sop_instance_uid = getattr(dataset, "SOPInstanceUID", None)
        if sop_instance_uid is None or str(sop_instance_uid) not in selected_uids:
            continue
        image_type = tuple(str(value).lower() for value in getattr(dataset, "ImageType", ()))
        role = image_type[2] if len(image_type) > 2 else "unknown"
        if role == "volume":
            continue
        columns = getattr(dataset, "Columns", None)
        rows = getattr(dataset, "Rows", None)
        photometric_interpretation = getattr(dataset, "PhotometricInterpretation", None)
        transfer_syntax_uid = getattr(
            getattr(dataset, "file_meta", None), "TransferSyntaxUID", None
        )
        if (
            columns is None
            or rows is None
            or photometric_interpretation is None
            or transfer_syntax_uid is None
        ):
            continue
        images.append(
            DicomAssociatedImage(
                role=role,
                dimensions=(int(columns), int(rows)),
                transfer_syntax_uid=str(transfer_syntax_uid),
                photometric_interpretation=str(photometric_interpretation),
                source_path=source_path,
            )
        )
    return tuple(images)


def _level_metadata(level: Level, pyramid_index: int) -> DicomLevelMetadata:
    instance = level.default_instance
    dataset = instance.dataset
    image_data = instance.image_data
    raw_dataset = dataset.as_dataset()
    decoder = getattr(image_data, "decoder", None)
    return DicomLevelMetadata(
        pyramid_index=pyramid_index,
        logical_level=int(level.level),
        dimensions=(int(level.size.width), int(level.size.height)),
        tile_size=(int(level.tile_size.width), int(level.tile_size.height)),
        microns_per_pixel=(float(level.mpp.width), float(level.mpp.height)),
        frame_count=int(dataset.frame_count),
        transfer_syntax_uid=str(image_data.transfer_syntax),
        photometric_interpretation=str(image_data.photometric_interpretation),
        dimension_organization_type=str(raw_dataset.DimensionOrganizationType),
        decoder=type(decoder).__name__ if decoder is not None else "unknown",
    )


class DicomSlide:
    def __init__(self, source: Path, slide: WsiDicom) -> None:
        self.source = source
        self._slide = slide
        self._level_metadata_cache: dict[int, DicomLevelMetadata] = {}

    @classmethod
    def open(
        cls,
        source: Path,
        *,
        decoded_frame_cache_size: int | None = None,
        encoded_frame_cache_size: int | None = None,
    ) -> Self:
        if not source.exists():
            raise FileNotFoundError(f"DICOM source does not exist: {source}")
        cache_sizes = (decoded_frame_cache_size, encoded_frame_cache_size)
        if any(value is not None and value < 0 for value in cache_sizes):
            raise ValueError("DICOM frame cache sizes must be non-negative")
        if decoded_frame_cache_size is None and encoded_frame_cache_size is None:
            return cls(source, WsiDicom.open(source))
        defaults = Settings()
        settings = Settings(
            decoded_frame_cache_size=(
                defaults.decoded_frame_cache_size
                if decoded_frame_cache_size is None
                else decoded_frame_cache_size
            ),
            encoded_frame_cache_size=(
                defaults.encoded_frame_cache_size
                if encoded_frame_cache_size is None
                else encoded_frame_cache_size
            ),
        )
        return cls(source, WsiDicom.open(source, settings=settings))

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        _exc_type: type[BaseException] | None,
        _exc_value: BaseException | None,
        _traceback: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        self._slide.close()

    @property
    def metadata(self) -> DicomSlideMetadata:
        return DicomSlideMetadata(
            levels=tuple(
                self._metadata_for_level(self._slide.levels[pyramid_index], pyramid_index)
                for pyramid_index in range(len(self._slide.levels))
            ),
            associated_images=_associated_images(self.source, self._slide),
        )

    def _metadata_for_level(self, level: Level, pyramid_index: int) -> DicomLevelMetadata:
        logical_level = int(level.level)
        metadata = self._level_metadata_cache.get(logical_level)
        if metadata is None:
            metadata = _level_metadata(level, pyramid_index)
            self._level_metadata_cache[logical_level] = metadata
        return metadata

    def _level(self, logical_level: int) -> tuple[int, Level]:
        for index in range(len(self._slide.levels)):
            level = self._slide.levels[index]
            if int(level.level) == logical_level:
                return index, level
        available = ", ".join(
            str(self._slide.levels[index].level) for index in range(len(self._slide.levels))
        )
        raise ValueError(f"DICOM logical level {logical_level} is absent; available: {available}")

    @staticmethod
    def _validate_tile(level: Level, tile_coordinate: tuple[int, int]) -> tuple[int, int]:
        tile_x, tile_y = tile_coordinate
        if tile_x < 0 or tile_y < 0:
            raise ValueError("DICOM tile coordinates must be non-negative")
        tiled_width = math.ceil(level.size.width / level.tile_size.width)
        tiled_height = math.ceil(level.size.height / level.tile_size.height)
        if tile_x >= tiled_width or tile_y >= tiled_height:
            raise ValueError(
                f"DICOM tile {tile_coordinate} is outside {tiled_width}x{tiled_height} grid"
            )
        return tiled_width, tiled_height

    def read_encoded_frame(
        self,
        logical_level: int,
        tile_coordinate: tuple[int, int],
    ) -> EncodedDicomFrame:
        pyramid_index, level = self._level(logical_level)
        tiled_width, _ = self._validate_tile(level, tile_coordinate)
        metadata = self._metadata_for_level(level, pyramid_index)
        tile_x, tile_y = tile_coordinate
        matrix_position = (
            tile_x * metadata.tile_size[0],
            tile_y * metadata.tile_size[1],
        )
        payload = self._slide.read_encoded_tile(
            logical_level,
            tile_coordinate,
            crop_to_image_boundary=False,
        )
        if not payload:
            raise ValueError(f"DICOM tile {tile_coordinate} returned an empty encoded frame")
        is_tiled_full = metadata.dimension_organization_type == "TILED_FULL"
        return EncodedDicomFrame(
            payload=payload,
            logical_level=logical_level,
            tile_coordinate=tile_coordinate,
            matrix_position=matrix_position,
            dicom_matrix_position=(matrix_position[0] + 1, matrix_position[1] + 1),
            frame_index=tile_y * tiled_width + tile_x if is_tiled_full else None,
            transfer_syntax_uid=metadata.transfer_syntax_uid,
            photometric_interpretation=metadata.photometric_interpretation,
            dimension_organization_type=metadata.dimension_organization_type,
        )

    def read_host_tile(
        self,
        logical_level: int,
        tile_coordinate: tuple[int, int],
    ) -> HostDicomTile:
        pyramid_index, level = self._level(logical_level)
        self._validate_tile(level, tile_coordinate)
        metadata = self._metadata_for_level(level, pyramid_index)
        with self._slide.read_tile(logical_level, tile_coordinate) as decoded:
            image = decoded.convert("RGB")
        return HostDicomTile(
            image=image,
            logical_level=logical_level,
            tile_coordinate=tile_coordinate,
            decoder=metadata.decoder,
        )
