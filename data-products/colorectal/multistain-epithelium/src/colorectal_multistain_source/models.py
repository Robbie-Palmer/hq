from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal, Self

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SourceVersion(StrictModel):
    label: Literal["V1"]
    major: Literal[1]
    minor: Literal[0]
    dataset_version_id: Literal[4496]
    state: Literal["RELEASED"]
    released_at: datetime


class DataverseRecord(StrictModel):
    record_url: AnyHttpUrl
    version_api_url: AnyHttpUrl


class ZenodoFile(StrictModel):
    name: str = Field(min_length=1)
    bytes: int = Field(gt=0)
    md5: str = Field(pattern=r"^[a-f0-9]{32}$")


class ZenodoRecord(StrictModel):
    record_id: Literal[14800740]
    record_url: AnyHttpUrl
    api_url: AnyHttpUrl
    files: list[ZenodoFile] = Field(min_length=1)


class AuthoritativeRecords(StrictModel):
    dataverse: DataverseRecord
    zenodo: ZenodoRecord


class CanonicalRights(StrictModel):
    name: Literal["CC0 1.0"]
    spdx_id: Literal["CC0-1.0"]
    url: AnyHttpUrl
    evidence: str = Field(min_length=1)


class RightsDiscrepancy(StrictModel):
    platform_license_id: Literal["cc-by-4.0"]
    description_license_spdx_id: Literal["CC0-1.0"]
    handling: str = Field(min_length=1)


class Rights(StrictModel):
    canonical: CanonicalRights
    zenodo_metadata_discrepancy: RightsDiscrepancy


class NativeTissue(StrEnum):
    CANCER = "Cancer"
    NORMAL_MUCOSA = "Normal mucosa"


class SourceArtifactRole(StrEnum):
    IMAGE_MASK_PAIRS = "image_mask_pairs"
    QUANTITATIVE_MEASUREMENTS = "project_specific_quantitative_measurements"
    PUBLISHER_DOCUMENTATION = "publisher_documentation"


class NativeAssay(StrEnum):
    H_AND_E = "H&E"
    IMMUNOHISTOCHEMISTRY = "Immunohistochemistry"
    ISH = "ISH"


class MarkerRole(StrEnum):
    HISTOLOGIC_STAIN = "histologic_stain"
    MIRNA_PROBE = "miRNA_probe"
    NEGATIVE_CONTROL = "negative_control"
    POSITIVE_CONTROL = "positive_control"
    PROTEIN = "protein"


class NativeRecordRole(StrEnum):
    SEMANTIC_SEGMENTATION_PAIR = "semantic segmentation training image-mask pair"


class NativeCorpus(StrictModel):
    patient_group_count: Literal[100]
    patient_group_pattern: str = Field(min_length=1)
    tissue_values: list[NativeTissue]
    normal_core_numbers: list[Literal[1, 2, 3]]
    cancer_core_numbers: list[Literal[4, 5, 6]]
    declared_cores_per_patient_per_tissue: Literal[3]
    represented_specimen_group_count: Literal[567]
    record_unit: str = Field(min_length=1)
    image_mask_pair_count: Literal[13179]
    image_format: Literal["image/jpeg"]
    mask_format: Literal["image/png"]
    magnification: Literal["40x"]
    annotation: str = Field(min_length=1)
    annotation_method: str = Field(min_length=1)
    annotation_validation: str = Field(min_length=1)
    publisher_role: str = Field(min_length=1)
    publisher_partition: None


class SourceArtifact(StrictModel):
    artifact_id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]+$")
    label: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._ -]+$")
    datafile_id: int = Field(gt=0)
    persistent_id: str = Field(pattern=r"^doi:10\.18710/DIGQGQ/[A-Z0-9]+$")
    bytes: int = Field(gt=0)
    content_type: Literal["application/zip", "text/plain"]
    md5: str = Field(pattern=r"^[a-f0-9]{32}$")
    source_role: SourceArtifactRole
    native_assay: NativeAssay | None
    native_marker: str | None
    marker_role: MarkerRole | None
    expected_pair_count: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def require_pair_metadata_together(self) -> Self:
        pair_values = (
            self.native_assay,
            self.native_marker,
            self.marker_role,
            self.expected_pair_count,
        )
        if self.source_role is SourceArtifactRole.IMAGE_MASK_PAIRS and any(
            value is None for value in pair_values
        ):
            raise ValueError("image-mask archives require assay, marker, role, and pair count")
        if self.source_role is not SourceArtifactRole.IMAGE_MASK_PAIRS and any(
            value is not None for value in pair_values
        ):
            raise ValueError("non-image artifacts cannot declare image-mask pair metadata")
        return self


class SourceManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["colorectal-cancer-ihc-cish-he-epithelium-segmentation-v1"]
    title: Literal["The Colorectal_Cancer_IHC_CISH_HE_Epithelium_Segmentation dataset"]
    doi: Literal["10.18710/DIGQGQ"]
    citation: str = Field(min_length=1)
    publisher: Literal["DataverseNO"]
    source_version: SourceVersion
    authoritative_records: AuthoritativeRecords
    rights: Rights
    native_corpus: NativeCorpus
    artifacts: list[SourceArtifact]

    @model_validator(mode="after")
    def require_complete_source_contract(self) -> Self:
        image_artifacts = [
            artifact
            for artifact in self.artifacts
            if artifact.source_role is SourceArtifactRole.IMAGE_MASK_PAIRS
        ]
        if len(image_artifacts) != 18:
            raise ValueError("source contract must preserve all 18 stain and marker archives")
        if sum(artifact.expected_pair_count or 0 for artifact in image_artifacts) != 13179:
            raise ValueError("archive pair counts must preserve all 13,179 native records")
        if len({artifact.artifact_id for artifact in self.artifacts}) != len(self.artifacts):
            raise ValueError("artifact IDs must be unique")
        if len({artifact.datafile_id for artifact in self.artifacts}) != len(self.artifacts):
            raise ValueError("Dataverse datafile IDs must be unique")
        if len({artifact.persistent_id for artifact in self.artifacts}) != len(self.artifacts):
            raise ValueError("artifact persistent IDs must be unique")
        if {artifact.native_assay for artifact in image_artifacts} != set(NativeAssay):
            raise ValueError("H&E, IHC, and publisher-native ISH assays are required")
        if {artifact.marker_role for artifact in image_artifacts} != set(MarkerRole):
            raise ValueError("marker archives must retain probes, controls, stain, and proteins")
        return self


class NativeRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: Literal["colorectal-cancer-ihc-cish-he-epithelium-segmentation-v1"]
    record_id: str = Field(pattern=r"^colorectal-multistain:v1:[a-f0-9]{64}$")
    patient_group_id: str = Field(pattern=r"^A\d{3}$")
    specimen_group_id: str = Field(pattern=r"^A\d{3}:(Cancer|Normal mucosa):[1-6]$")
    native_tissue: NativeTissue
    native_core_number: int = Field(ge=1, le=6)
    native_assay: NativeAssay
    native_marker: str = Field(min_length=1)
    marker_role: MarkerRole
    source_acquisition_label: str = Field(min_length=1)
    source_role: NativeRecordRole
    source_artifact_id: str = Field(min_length=1)
    source_artifact_persistent_id: str = Field(min_length=1)
    source_pair_stem: str = Field(min_length=1)
    image_member: str = Field(min_length=1)
    image_role: Literal["TMA core image"]
    mask_member: str = Field(min_length=1)
    mask_role: Literal["epithelium segmentation mask"]
    publisher_partition: None
