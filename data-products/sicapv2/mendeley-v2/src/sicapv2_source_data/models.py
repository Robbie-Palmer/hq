from __future__ import annotations

from typing import Literal, Self

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Contributor(StrictModel):
    profile_id: str = Field(min_length=1)
    name: Literal["Julio Silva-Rodríguez"]


class Institution(StrictModel):
    name: Literal["Universitat Politecnica de Valencia"]
    ror_id: AnyHttpUrl


class License(StrictModel):
    spdx_id: Literal["CC-BY-4.0"]
    name: Literal["Creative Commons Attribution 4.0 International"]
    url: AnyHttpUrl
    attribution: str = Field(min_length=1)


class Archive(StrictModel):
    file_id: Literal["6ab087a7-ca89-47ac-9698-f6546bb50f98"]
    filename: Literal["SICAPv2.zip"]
    url: AnyHttpUrl
    content_type: Literal["application/x-zip-compressed"]
    bytes: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    created_at: str = Field(min_length=1)


class PhysicalScale(StrictModel):
    source_magnification: Literal["40X"]
    patch_magnification: Literal["10X"]
    downsample_factor: Literal[4]
    patch_width_pixels: Literal[512]
    patch_height_pixels: Literal[512]
    overlap_fraction: float = Field(ge=0.5, le=0.5)
    minimum_tissue_fraction: float = Field(ge=0.2, le=0.2)
    coordinate_frame: Literal["publisher_wsi"]
    coordinate_unit: Literal["source_pixel"]


class NativeMaskLabel(StrictModel):
    id: int = Field(ge=0, le=3)
    name: Literal["NC", "GG3", "GG4", "GG5"]
    description: str = Field(min_length=1)


class PublishedPartition(StrictModel):
    id: Literal["test", "validation_val1", "validation_val2", "validation_val3", "validation_val4"]
    path: str = Field(pattern=r"^SICAPv2/partition/")


class ExpectedPatchLabelCounts(StrictModel):
    NC: int = Field(ge=0)
    G3: int = Field(ge=0)
    G4: int = Field(ge=0)
    G5: int = Field(ge=0)
    G4C: int = Field(ge=0)


class ExpectedCounts(StrictModel):
    patient_count: int = Field(gt=0)
    slide_count: int = Field(gt=0)
    patch_count: int = Field(gt=0)
    image_count: int = Field(gt=0)
    mask_count: int = Field(gt=0)
    archive_member_count: int = Field(gt=0)
    published_labelled_patch_count: int = Field(gt=0)
    published_patch_label_counts: ExpectedPatchLabelCounts


class SourceManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["sicapv2-mendeley-v2"]
    title: str = Field(min_length=1)
    doi: Literal["10.17632/9xxm58dvs3.2"]
    paper_doi: Literal["10.1016/j.cmpb.2020.105637"]
    publisher: Literal["Mendeley Data"]
    publisher_record: AnyHttpUrl
    publisher_dataset_id: Literal["9xxm58dvs3"]
    publisher_version: Literal[2]
    published_at: Literal["2020-10-22T13:41:01.412Z"]
    source_release: Literal["Version 1: 2020-05"]
    contributor: Contributor
    institution: Institution
    license: License
    archive: Archive
    scale: PhysicalScale
    native_mask_labels: list[NativeMaskLabel]
    published_patch_labels: list[Literal["NC", "G3", "G4", "G5", "G4C"]]
    published_partitions: list[PublishedPartition]
    expected: ExpectedCounts

    @model_validator(mode="after")
    def preserve_complete_native_contract(self) -> Self:
        if [(label.id, label.name) for label in self.native_mask_labels] != [
            (0, "NC"),
            (1, "GG3"),
            (2, "GG4"),
            (3, "GG5"),
        ]:
            raise ValueError("SICAPv2 mask labels must preserve publisher values 0 through 3")
        if self.published_patch_labels != ["NC", "G3", "G4", "G5", "G4C"]:
            raise ValueError("SICAPv2 patch labels must preserve publisher column order")
        if len({partition.id for partition in self.published_partitions}) != 5:
            raise ValueError("SICAPv2 must preserve the test partition and four validation folds")
        return self


class OriginalArtifact(StrictModel):
    artifact_ref: str = Field(pattern=r"^sicapv2:v2:artifact:")
    archive_ref: Literal["mendeley:9xxm58dvs3:v2:file:6ab087a7-ca89-47ac-9698-f6546bb50f98"]
    member_path: str = Field(pattern=r"^SICAPv2/")
    bytes: int = Field(ge=0)
    crc32: str = Field(pattern=r"^[a-f0-9]{8}$")
    media_type: str = Field(min_length=1)


class PublishedRole(StrictModel):
    partition_id: Literal[
        "test", "validation_val1", "validation_val2", "validation_val3", "validation_val4"
    ]
    task: Literal["gleason_grading", "cribriform_detection"]
    role: Literal["train", "test"]
    table_artifact_ref: str = Field(pattern=r"^sicapv2:v2:artifact:")


class PublishedPatchLabels(StrictModel):
    NC: int = Field(ge=0, le=1)
    G3: int = Field(ge=0, le=1)
    G4: int = Field(ge=0, le=1)
    G5: int = Field(ge=0, le=1)
    G4C: int = Field(ge=0, le=1)


class PatchCoordinates(StrictModel):
    region: int = Field(ge=0)
    row: int = Field(ge=0)
    column: int = Field(ge=0)
    xini: int = Field(ge=0)
    yini: int = Field(ge=0)
    coordinate_frame: Literal["publisher_wsi"] = "publisher_wsi"
    coordinate_unit: Literal["source_pixel"] = "source_pixel"


class PatientRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: Literal["sicapv2-mendeley-v2"] = "sicapv2-mendeley-v2"
    record_ref: str = Field(pattern=r"^sicapv2:v2:patient:")
    patient_id: str = Field(min_length=1)
    slide_refs: list[str] = Field(min_length=1)


class SlideRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: Literal["sicapv2-mendeley-v2"] = "sicapv2-mendeley-v2"
    record_ref: str = Field(pattern=r"^sicapv2:v2:slide:")
    slide_id: str = Field(min_length=1)
    patient_ref: str = Field(pattern=r"^sicapv2:v2:patient:")
    patient_id: str = Field(min_length=1)
    gleason_primary: int = Field(ge=0, le=5)
    gleason_secondary: int = Field(ge=0, le=5)
    global_gleason_score: str = Field(pattern=r"^(NC|[345]\+[345]=[6-9]|5\+5=10)$")
    grade_group: int = Field(ge=0, le=5)
    grade_group_provenance: Literal["lossless_isup_mapping_from_published_primary_secondary"]
    source_table_artifact_ref: str = Field(pattern=r"^sicapv2:v2:artifact:")
    patch_refs: list[str]


class PatchRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: Literal["sicapv2-mendeley-v2"] = "sicapv2-mendeley-v2"
    record_ref: str = Field(pattern=r"^sicapv2:v2:patch:")
    patch_id: str = Field(min_length=1)
    slide_ref: str = Field(pattern=r"^sicapv2:v2:slide:")
    slide_id: str = Field(min_length=1)
    patient_ref: str = Field(pattern=r"^sicapv2:v2:patient:")
    coordinates: PatchCoordinates
    scale: PhysicalScale
    image: OriginalArtifact
    gleason_pattern_mask: OriginalArtifact
    mask_label_ids: tuple[Literal[0], Literal[1], Literal[2], Literal[3]]
    published_labels: PublishedPatchLabels | None
    published_roles: list[PublishedRole]
