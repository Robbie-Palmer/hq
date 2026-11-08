from __future__ import annotations

import hashlib
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from PIL import Image

from pathologize_tiling_benchmark import fixture_matrix
from pathologize_tiling_benchmark.fixture_matrix import (
    SourceObject,
    acquire_fixtures,
    load_matrix,
    run_probes,
    select_level_for_mpp,
)

PROJECT_ROOT = Path(__file__).parents[1]


def test_matrix_covers_requested_families_codecs_and_trial_states() -> None:
    matrix = load_matrix(PROJECT_ROOT)

    assert len(matrix.fixtures) == 6
    assert {fixture.family for fixture in matrix.fixtures} == {
        "aperio",
        "leica",
        "tiled_tiff",
        "dicom_wsi",
    }
    assert {fixture.compression for fixture in matrix.fixtures} == {"jpeg", "jpeg2000"}
    possible = {
        fixture.fixture_id
        for fixture in matrix.fixtures
        if fixture.gpu_trial.status == "possible_now"
    }
    assert possible == {"dicom-leica-4-jpeg-sparse", "dicom-cptac-coad-jpeg2000"}


@pytest.mark.parametrize(
    ("base_mpp", "downsamples", "target_mpp", "expected"),
    [
        ((0.5, 0.75), ((1.0, 1.0), (2.0, 2.0), (4.0, 4.0)), (1.0, 1.5), 1),
        ((0.5, 0.75), ((1.0, 1.0), (2.0, 1.5), (4.0, 4.0)), (1.0, 1.125), 1),
        ((0.5, 0.75), ((1.0, 1.0), (2.0, 2.0), (4.0, 4.0)), (1.7, 2.8), 2),
        ((0.5, 0.75), ((1.0, 1.0), (2.0, 2.0), (4.0, 4.0)), (0.5, 0.75), 0),
    ],
)
def test_level_selection_uses_both_mpp_axes(
    base_mpp: tuple[float, float],
    downsamples: tuple[tuple[float, float], ...],
    target_mpp: tuple[float, float],
    expected: int,
) -> None:
    assert select_level_for_mpp(base_mpp, downsamples, target_mpp) == expected


@pytest.mark.parametrize(
    ("base_mpp", "downsamples", "target_mpp"),
    [
        ((0.0, 0.5), ((1.0, 1.0),), (0.5, 0.5)),
        ((0.5, 0.5), (), (0.5, 0.5)),
        ((0.5, 0.5), ((float("nan"), 1.0),), (0.5, 0.5)),
        ((0.5, 0.5), ((1.0, 1.0),), (0.5, float("inf"))),
    ],
)
def test_level_selection_rejects_invalid_scale(
    base_mpp: tuple[float, float],
    downsamples: tuple[tuple[float, float], ...],
    target_mpp: tuple[float, float],
) -> None:
    with pytest.raises(ValueError, match="finite and positive"):
        select_level_for_mpp(base_mpp, downsamples, target_mpp)


def test_source_verification_checks_size_and_digest(tmp_path: Path) -> None:
    source_path = tmp_path / "fixture.bin"
    source_path.write_bytes(b"fixture")
    source = SourceObject(
        path=source_path.name,
        url="https://example.invalid/fixture.bin",
        bytes=7,
        sha256=hashlib.sha256(b"fixture").hexdigest(),
    )

    fixture_matrix._verify_source(source_path, source)
    with pytest.raises(ValueError, match="size differs"):
        fixture_matrix._verify_source(source_path, source.model_copy(update={"bytes": 8}))
    with pytest.raises(ValueError, match="SHA-256 differs"):
        fixture_matrix._verify_source(source_path, source.model_copy(update={"sha256": "0" * 64}))


def test_source_paths_cannot_escape_fixture_root() -> None:
    with pytest.raises(ValueError, match="below the fixture root"):
        SourceObject(
            path="../fixture.bin",
            url="https://example.invalid/fixture.bin",
            bytes=7,
            sha256="0" * 64,
        )
    with pytest.raises(ValueError, match="must use HTTPS"):
        SourceObject(
            path="fixture.bin",
            url="http://example.invalid/fixture.bin",
            bytes=7,
            sha256="0" * 64,
        )


def test_safe_extract_rejects_parent_traversal(tmp_path: Path) -> None:
    safe_archive = tmp_path / "safe.zip"
    with zipfile.ZipFile(safe_archive, "w") as zipped:
        zipped.writestr("series/slide.dcm", b"dicom")
    fixture_matrix._safe_extract(safe_archive, tmp_path / "safe")
    assert (tmp_path / "safe/series/slide.dcm").read_bytes() == b"dicom"

    unsafe_archive = tmp_path / "unsafe.zip"
    with zipfile.ZipFile(unsafe_archive, "w") as zipped:
        zipped.writestr("../escape.dcm", b"dicom")
    with pytest.raises(ValueError, match="escapes fixture root"):
        fixture_matrix._safe_extract(unsafe_archive, tmp_path / "unsafe")


def test_smoke_acquisition_does_not_select_extended_fixtures(tmp_path: Path) -> None:
    downloaded: list[Path] = []

    def record_download(_source: SourceObject, destination: Path) -> None:
        downloaded.append(destination)

    with patch.object(fixture_matrix, "_download", side_effect=record_download):
        result = acquire_fixtures(PROJECT_ROOT, tmp_path, "smoke")

    assert result == {"fixtures": 1, "downloaded": 1, "reused": 0}
    assert downloaded[0].name == "CMU-1-Small-Region.svs"
    with pytest.raises(ValueError, match="smoke or extended"):
        acquire_fixtures(PROJECT_ROOT, tmp_path, "unknown")


class FakeOpenSlide:
    level_dimensions = ((8, 8), (4, 4))
    level_downsamples = (1.0, 2.0)

    def __init__(self, _path: Path) -> None:
        pass

    @classmethod
    def detect_format(cls, _path: Path) -> str:
        return "aperio"

    def __enter__(self) -> FakeOpenSlide:
        return self

    def __exit__(self, *_args: object) -> None:
        pass

    def read_region(
        self,
        _location: tuple[int, int],
        _level: int,
        size: tuple[int, int],
    ) -> Image.Image:
        return Image.new("RGBA", size)


def test_openslide_probe_reads_a_boundary_tile(tmp_path: Path) -> None:
    fixture = (
        load_matrix(PROJECT_ROOT)
        .fixtures[0]
        .model_copy(
            update={
                "levels": (
                    load_matrix(PROJECT_ROOT).fixtures[0].levels[0],
                    load_matrix(PROJECT_ROOT)
                    .fixtures[0]
                    .levels[0]
                    .model_copy(
                        update={
                            "logical_level": 1,
                            "dimensions": (4, 4),
                            "downsample": (2.0, 2.0),
                            "mpp": (0.998, 0.998),
                        }
                    ),
                )
            }
        )
    )

    with patch.object(fixture_matrix, "OpenSlide", FakeOpenSlide):
        result = fixture_matrix._probe_openslide(tmp_path / "slide.svs", fixture)

    assert result.status == "passed"
    assert result.selected_level == 1
    assert result.boundary_size == (240, 240)
    assert result.timing is not None
    assert result.timing.warm_repetitions == 5


class FakeDicomSlide:
    metadata = SimpleNamespace(
        levels=[SimpleNamespace(decoder="FakeDecoder")],
    )

    @classmethod
    def open(cls, _path: Path) -> FakeDicomSlide:
        return cls()

    def __enter__(self) -> FakeDicomSlide:
        return self

    def __exit__(self, *_args: object) -> None:
        pass

    @staticmethod
    def read_host_tile(_logical_level: int, _coordinate: tuple[int, int]) -> SimpleNamespace:
        return SimpleNamespace(image=Image.new("RGB", (256, 256)))


def test_dicom_probe_records_optional_decoder_fallback(tmp_path: Path) -> None:
    fixture = next(
        item
        for item in load_matrix(PROJECT_ROOT).fixtures
        if item.fixture_id == "dicom-leica-4-jpeg-sparse"
    ).model_copy(update={"levels": (load_matrix(PROJECT_ROOT).fixtures[-1].levels[0],)})
    capability = SimpleNamespace(available=False, reason="nvImageCodec is unavailable")

    with (
        patch.object(fixture_matrix, "DicomSlide", FakeDicomSlide),
        patch.object(fixture_matrix, "probe_nvimagecodec", return_value=capability),
    ):
        result = fixture_matrix._probe_dicom(tmp_path, fixture)

    assert result.status == "passed"
    assert result.backend == "wsidicom/FakeDecoder"
    assert result.fallback_reason == "nvImageCodec is unavailable"


def test_probe_report_allows_missing_extended_fixtures(tmp_path: Path) -> None:
    report = run_probes(PROJECT_ROOT, tmp_path, require_all=False)

    assert report.anisotropic_level_selection_passed
    assert len(report.results) == 6
    assert {result.status for result in report.results} == {"missing"}
    assert report.environment.logical_cpus >= 1
    assert "openslide-python" in report.environment.dependencies

    with pytest.raises(FileNotFoundError, match="not materialized"):
        run_probes(PROJECT_ROOT, tmp_path, require_all=True)
