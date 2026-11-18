from __future__ import annotations

from typing import Literal

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Archive(StrictModel):
    filename: Literal["MPP20.tar"]
    url: AnyHttpUrl
    bytes: int = Field(gt=0)
    md5: str = Field(pattern=r"^[0-9a-f]{32}$")
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class NativeLabel(StrictModel):
    id: int = Field(ge=0, le=255)
    name: str = Field(pattern=r"^[a-z][a-z0-9_]+$")


class ExpectedScale(StrictModel):
    declared_wsi_count: int = Field(gt=0)
    paired_patch_count: int = Field(gt=0)
    organs: list[str] = Field(min_length=1)


class License(StrictModel):
    name: str = Field(min_length=1)
    spdx_id: str = Field(min_length=1)
    url: AnyHttpUrl
    redistribution: str = Field(min_length=1)


class SourceManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["grandqc-test-mpp20-v1"]
    description: str = Field(min_length=1)
    doi: Literal["10.5281/zenodo.14039591"]
    source_version: str = Field(min_length=1)
    citation: str = Field(min_length=1)
    native_role: Literal["publisher_test_dataset"]
    license: License
    archive: Archive
    native_labels: list[NativeLabel] = Field(min_length=1)
    expected: ExpectedScale

    @model_validator(mode="after")
    def labels_are_unique(self) -> SourceManifest:
        ids = [label.id for label in self.native_labels]
        names = [label.name for label in self.native_labels]
        if len(ids) != len(set(ids)) or len(names) != len(set(names)):
            raise ValueError("native label IDs and names must be unique")
        return self


class NativePatchRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: Literal["grandqc-test-mpp20-v1"] = "grandqc-test-mpp20-v1"
    sample_id: str = Field(pattern=r"^grandqc:[0-9a-f]{64}$")
    organ: str = Field(min_length=1)
    source_group_id: str = Field(min_length=1)
    native_role: Literal["publisher_test_dataset"] = "publisher_test_dataset"
    image_path: str = Field(min_length=1)
    mask_path: str = Field(min_length=1)
    micrometres_per_pixel: float = Field(default=2.0, ge=2.0, le=2.0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    native_label_ids_present: list[int]
    native_label_pixel_counts: dict[str, int]
