from __future__ import annotations

from dataclasses import dataclass
from importlib import import_module
from typing import Any, Protocol, cast

from .dicom import EncodedDicomFrame

_NVIMAGECODEC_DICOM_TRANSFER_SYNTAXES = {
    "1.2.840.10008.1.2.4.50",
    "1.2.840.10008.1.2.4.90",
    "1.2.840.10008.1.2.4.91",
}
_NVIMAGECODEC_DICOM_PHOTOMETRIC_INTERPRETATIONS = {
    "RGB",
    "YBR_FULL",
    "YBR_FULL_422",
    "YBR_ICT",
    "YBR_RCT",
}


class CudaArrayImage(Protocol):
    @property
    def __cuda_array_interface__(self) -> dict[str, object]: ...


@dataclass(frozen=True, slots=True)
class CudaDecoderCapability:
    backend: str
    available: bool
    reason: str | None


@dataclass(frozen=True, slots=True)
class DeviceDecodeBatch:
    images: tuple[CudaArrayImage, ...]
    backend: str
    compressed_bytes: int


class DeviceDecodeUnavailableError(RuntimeError):
    pass


def _nvimagecodec_module() -> Any:  # noqa: ANN401 - optional extension has no stub package.
    try:
        return import_module("nvidia.nvimgcodec")
    except (ImportError, OSError) as error:
        raise DeviceDecodeUnavailableError(f"nvImageCodec is unavailable: {error}") from error


def probe_nvimagecodec() -> CudaDecoderCapability:
    try:
        NvImageCodecDecoder()
    except DeviceDecodeUnavailableError as error:
        return CudaDecoderCapability("nvimagecodec", False, str(error))
    return CudaDecoderCapability("nvimagecodec", True, None)


def _require_cuda_array(image: object, index: int) -> CudaArrayImage:
    interface = getattr(image, "__cuda_array_interface__", None)
    if not isinstance(interface, dict) or "data" not in interface or "shape" not in interface:
        raise DeviceDecodeUnavailableError(
            f"nvImageCodec result {index} does not expose the CUDA array interface"
        )
    return cast(CudaArrayImage, image)


class NvImageCodecDecoder:
    def __init__(self) -> None:
        module = _nvimagecodec_module()
        try:
            self._decoder = module.Decoder()
            self._parameters = module.DecodeParams(
                allow_any_depth=True,
                color_spec=module.ColorSpec.SRGB,
            )
        except (RuntimeError, ValueError) as error:
            raise DeviceDecodeUnavailableError(
                f"nvImageCodec initialization failed: {error}"
            ) from error

    def decode(
        self, frames: tuple[bytes, ...], *, cuda_stream: int | object | None = None
    ) -> DeviceDecodeBatch:
        if not frames:
            raise ValueError("at least one encoded frame is required")
        try:
            decoded = self._decoder.decode(
                list(frames), params=self._parameters, cuda_stream=cuda_stream
            )
        except (RuntimeError, ValueError) as error:
            raise DeviceDecodeUnavailableError(f"nvImageCodec decode failed: {error}") from error
        if len(decoded) != len(frames):
            raise DeviceDecodeUnavailableError(
                f"nvImageCodec returned {len(decoded)} images for {len(frames)} frames"
            )
        if any(image is None for image in decoded):
            failed = [index for index, image in enumerate(decoded) if image is None]
            raise DeviceDecodeUnavailableError(f"nvImageCodec failed frame indexes {failed}")
        return DeviceDecodeBatch(
            images=tuple(_require_cuda_array(image, index) for index, image in enumerate(decoded)),
            backend="nvimagecodec",
            compressed_bytes=sum(len(frame) for frame in frames),
        )


def decode_frames_nvimagecodec(frames: tuple[bytes, ...]) -> DeviceDecodeBatch:
    if not frames:
        raise ValueError("at least one encoded frame is required")
    return NvImageCodecDecoder().decode(frames)


def decode_dicom_frames_nvimagecodec(
    frames: tuple[EncodedDicomFrame, ...],
    *,
    decoder: NvImageCodecDecoder | None = None,
    cuda_stream: int | object | None = None,
) -> DeviceDecodeBatch:
    if not frames:
        raise ValueError("at least one encoded DICOM frame is required")
    for index, frame in enumerate(frames):
        if frame.transfer_syntax_uid not in _NVIMAGECODEC_DICOM_TRANSFER_SYNTAXES:
            raise DeviceDecodeUnavailableError(
                f"DICOM frame {index} uses unsupported transfer syntax {frame.transfer_syntax_uid}"
            )
        if frame.photometric_interpretation not in _NVIMAGECODEC_DICOM_PHOTOMETRIC_INTERPRETATIONS:
            raise DeviceDecodeUnavailableError(
                f"DICOM frame {index} uses unsupported photometric interpretation "
                f"{frame.photometric_interpretation}"
            )
    selected = decoder or NvImageCodecDecoder()
    return selected.decode(tuple(frame.payload for frame in frames), cuda_stream=cuda_stream)
