import hashlib
from pathlib import Path
from typing import Protocol

import pytest

from pathologize_data_products import (
    AccessTier,
    ArtifactReference,
    ArtifactRole,
    Checksum,
    CoordinateFrame,
    ProductVersion,
    Rights,
)


@pytest.fixture
def rights() -> Rights:
    return Rights(
        license="CC0-1.0",
        redistribution="Redistribution permitted.",
        evidence_uri="https://example.test/rights",
    )


class ArtifactFactory(Protocol):
    def __call__(
        self,
        product: ProductVersion,
        root: Path,
        relative_path: str,
        content: bytes,
        *,
        record: str = "record-1",
        role: ArtifactRole = ArtifactRole.SOURCE_RECORDS,
        media_type: str = "application/json",
    ) -> ArtifactReference: ...


@pytest.fixture
def make_artifact(rights: Rights) -> ArtifactFactory:
    def factory(
        product: ProductVersion,
        root: Path,
        relative_path: str,
        content: bytes,
        *,
        record: str = "record-1",
        role: ArtifactRole = ArtifactRole.SOURCE_RECORDS,
        media_type: str = "application/json",
    ) -> ArtifactReference:
        path = root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        coordinate_frame = None
        if media_type.startswith("image/"):
            coordinate_frame = CoordinateFrame(
                name="native_pixels", axes=("x", "y"), origin="top_left"
            )
        return ArtifactReference(
            product=product,
            source_record=record,
            role=role,
            path=relative_path,
            checksum=Checksum(value=hashlib.sha256(content).hexdigest()),
            media_type=media_type,
            rights=rights,
            access_tier=AccessTier.PUBLIC,
            coordinate_frame=coordinate_frame,
        )

    return factory
