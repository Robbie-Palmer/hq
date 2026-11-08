from __future__ import annotations

from types import SimpleNamespace
from typing import ClassVar
from unittest.mock import patch

import pytest

from pathologize_tiler.cuda import (
    DeviceDecodeUnavailableError,
    NvImageCodecDecoder,
    decode_dicom_frames_nvimagecodec,
    decode_frames_nvimagecodec,
    probe_nvimagecodec,
)
from pathologize_tiler.dicom import EncodedDicomFrame


class FakeImage:
    __cuda_array_interface__: ClassVar[dict[str, object]] = {
        "shape": (256, 256, 3),
        "typestr": "|u1",
        "data": (1234, False),
        "version": 3,
        "stream": 1,
    }


class FakeDecoder:
    def decode(
        self, frames: list[bytes], *, params: object, cuda_stream: object | None = None
    ) -> list[FakeImage]:
        assert params is not None
        assert cuda_stream in (None, 99)
        return [FakeImage() for _ in frames]


class FailingDecoder:
    def decode(
        self, frames: list[bytes], *, params: object, cuda_stream: object | None = None
    ) -> list[None]:
        assert frames
        assert params is not None
        assert cuda_stream is None
        return [None]


class ShortDecoder:
    def decode(
        self, frames: list[bytes], *, params: object, cuda_stream: object | None = None
    ) -> list[FakeImage]:
        assert frames
        assert params is not None
        assert cuda_stream is None
        return []


class InvalidImageDecoder:
    def decode(
        self, frames: list[bytes], *, params: object, cuda_stream: object | None = None
    ) -> list[object]:
        assert frames
        assert params is not None
        assert cuda_stream is None
        return [object()]


class FakeDecodeParams:
    def __init__(self, *, allow_any_depth: bool, color_spec: str) -> None:
        assert allow_any_depth
        assert color_spec == "srgb"


def _fake_module() -> SimpleNamespace:
    return SimpleNamespace(
        Decoder=FakeDecoder,
        DecodeParams=FakeDecodeParams,
        ColorSpec=SimpleNamespace(SRGB="srgb"),
    )


def _dicom_frame(
    *,
    transfer_syntax_uid: str = "1.2.840.10008.1.2.4.91",
    photometric_interpretation: str = "YBR_ICT",
) -> EncodedDicomFrame:
    return EncodedDicomFrame(
        payload=b"frame",
        logical_level=0,
        tile_coordinate=(0, 0),
        matrix_position=(0, 0),
        dicom_matrix_position=(1, 1),
        frame_index=0,
        transfer_syntax_uid=transfer_syntax_uid,
        photometric_interpretation=photometric_interpretation,
        dimension_organization_type="TILED_FULL",
    )


def test_probe_reports_missing_optional_runtime() -> None:
    with patch("pathologize_tiler.cuda.import_module", side_effect=ImportError("not installed")):
        capability = probe_nvimagecodec()

    assert not capability.available
    assert capability.backend == "nvimagecodec"
    assert capability.reason == "nvImageCodec is unavailable: not installed"


def test_probe_reports_available_runtime() -> None:
    with patch("pathologize_tiler.cuda.import_module", return_value=_fake_module()):
        capability = probe_nvimagecodec()

    assert capability.available
    assert capability.reason is None


def test_direct_decode_preserves_device_results() -> None:
    with patch("pathologize_tiler.cuda.import_module", return_value=_fake_module()):
        batch = decode_frames_nvimagecodec((b"frame-one", b"frame-two"))

    assert batch.backend == "nvimagecodec"
    assert batch.compressed_bytes == 18
    assert len(batch.images) == 2
    assert batch.images[0].__cuda_array_interface__["data"] == (1234, False)


def test_dicom_decode_validates_codec_and_color_before_device_work() -> None:
    with patch("pathologize_tiler.cuda.import_module", return_value=_fake_module()):
        decoder = NvImageCodecDecoder()
        batch = decode_dicom_frames_nvimagecodec((_dicom_frame(),), decoder=decoder, cuda_stream=99)

    assert len(batch.images) == 1

    with pytest.raises(DeviceDecodeUnavailableError, match="unsupported transfer syntax"):
        decode_dicom_frames_nvimagecodec(
            (_dicom_frame(transfer_syntax_uid="1.2.840.10008.1.2.5"),),
            decoder=decoder,
        )
    with pytest.raises(
        DeviceDecodeUnavailableError, match="unsupported photometric interpretation"
    ):
        decode_dicom_frames_nvimagecodec(
            (_dicom_frame(photometric_interpretation="PALETTE COLOR"),),
            decoder=decoder,
        )


def test_dicom_decode_rejects_empty_batch() -> None:
    with pytest.raises(ValueError, match="at least one encoded DICOM frame"):
        decode_dicom_frames_nvimagecodec(())


def test_direct_decode_rejects_empty_and_failed_batches() -> None:
    with pytest.raises(ValueError, match="at least one encoded frame"):
        decode_frames_nvimagecodec(())

    module = _fake_module()
    module.Decoder = FailingDecoder
    with (
        patch("pathologize_tiler.cuda.import_module", return_value=module),
        pytest.raises(DeviceDecodeUnavailableError, match="failed frame indexes"),
    ):
        decode_frames_nvimagecodec((b"frame",))


@pytest.mark.parametrize(
    ("decoder", "message"),
    [
        (ShortDecoder, "returned 0 images for 1 frames"),
        (InvalidImageDecoder, "does not expose the CUDA array interface"),
    ],
)
def test_direct_decode_rejects_invalid_results(
    decoder: type[ShortDecoder] | type[InvalidImageDecoder], message: str
) -> None:
    module = _fake_module()
    module.Decoder = decoder
    with (
        patch("pathologize_tiler.cuda.import_module", return_value=module),
        pytest.raises(DeviceDecodeUnavailableError, match=message),
    ):
        decode_frames_nvimagecodec((b"frame",))
