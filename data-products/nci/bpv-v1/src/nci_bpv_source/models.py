from __future__ import annotations

from typing import Any, Literal, Self

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SourceReference(StrictModel):
    title: str = Field(min_length=1)
    url: AnyHttpUrl


class Substudy(StrictModel):
    accession: str = Field(pattern=r"^phs\d{6}\.v\d+\.p\d+$")
    native_name: str = Field(min_length=1)
    table_accession: str = Field(pattern=r"^pht\d{6}\.v\d+$")
    reported_counts: dict[str, int] = Field(min_length=2)
    materials: list[str] = Field(min_length=1)
    preanalytic_variables: list[str] = Field(min_length=1)
    assays: list[str] = Field(min_length=1)
    platforms: list[str] = Field(min_length=1)
    native_outcomes: list[str] = Field(min_length=1)
    required_variables: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def values_are_unique_and_positive(self) -> Self:
        for values in (
            self.materials,
            self.preanalytic_variables,
            self.assays,
            self.platforms,
            self.native_outcomes,
            self.required_variables,
        ):
            if len(values) != len(set(values)):
                raise ValueError(f"{self.accession}: repeated source value")
        if any(value <= 0 for value in self.reported_counts.values()):
            raise ValueError(f"{self.accession}: reported counts must be positive")
        return self


class StudyContract(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    study_accession: Literal["phs001304.v1.p1"]
    bioproject_accession: Literal["PRJNA932917"]
    bioproject_id: Literal[932917]
    consented_subject_count: Literal[153]
    study_design: Literal["Case Set"]
    diagnoses: list[str] = Field(min_length=4, max_length=4)
    publisher_partition_roles: list[str] = Field(max_length=0)
    sop_library_revision: Literal["2019-02-13"]
    sop_documents: list[str] = Field(min_length=30)
    substudies: list[Substudy] = Field(min_length=7, max_length=7)
    publications: list[SourceReference] = Field(min_length=5)
    source_references: list[SourceReference] = Field(min_length=10)

    @model_validator(mode="after")
    def substudy_identities_are_unique(self) -> Self:
        for values in (
            [item.accession for item in self.substudies],
            [item.native_name for item in self.substudies],
            [item.table_accession for item in self.substudies],
        ):
            if len(values) != len(set(values)):
                raise ValueError("substudy accessions, names, and tables must be unique")
        return self


class PublicMetadataFile(StrictModel):
    artifact_id: str = Field(min_length=1)
    file_name: str = Field(pattern=r"^[A-Za-z0-9_.-]+$")
    kind: Literal["study_exchange", "data_dictionary", "variable_report"]
    url: AnyHttpUrl
    bytes: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class ControlledDataset(StrictModel):
    accession: str = Field(min_length=1)
    native_name: str = Field(min_length=1)
    role: str = Field(min_length=1)
    access_tier: Literal["dbGaP authorized"]
    bytes: None
    checksum: None
    missing_reason: Literal[
        "Visible only after authorization",
        "Repository file manifests, sizes, and checksums require authorization",
    ]


class SourceInventory(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: str = Field(min_length=1)
    public_metadata_files: list[PublicMetadataFile] = Field(min_length=15, max_length=15)
    controlled_dataset_families: list[ControlledDataset] = Field(min_length=11)

    @model_validator(mode="after")
    def artifacts_are_unique(self) -> Self:
        for values in (
            [item.artifact_id for item in self.public_metadata_files],
            [item.file_name for item in self.public_metadata_files],
            [str(item.url) for item in self.public_metadata_files],
        ):
            if len(values) != len(set(values)):
                raise ValueError("public metadata artifact identities must be unique")
        return self


class AccessAndRights(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: str = Field(min_length=1)
    public_access: str = Field(min_length=1)
    controlled_access: str = Field(min_length=1)
    redistribution: str = Field(min_length=1)
    checksum_policy: str = Field(min_length=1)
    roles: list[str] = Field(min_length=1)
    duties: list[str] = Field(min_length=1)
    authoritative_sources: list[SourceReference] = Field(min_length=1)


class IdentityContract(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: str = Field(min_length=1)
    native_granularities: list[str] = Field(min_length=6)
    required_identity_fields: list[str] = Field(min_length=5)
    link_fields: list[str] = Field(min_length=3)
    native_preanalytic_fields: list[str] = Field(min_length=9)
    artifact_fields: list[str] = Field(min_length=8)
    missingness_rule: str = Field(min_length=1)
    pairing_rule: str = Field(min_length=1)
    partition_rule: str = Field(min_length=1)
    controlled_data_rule: str = Field(min_length=1)


class AuthorizedArtifact(StrictModel):
    artifact_id: str = Field(min_length=1)
    native_file_name: str = Field(min_length=1)
    repository_url: AnyHttpUrl
    access_tier: Literal["public", "dbGaP authorized"]
    bytes: int | None = Field(default=None, gt=0)
    checksum_algorithm: Literal["md5", "sha256"] | None = None
    checksum: str | None = None
    missing_reason: str | None = None

    @model_validator(mode="after")
    def checksum_or_missing_reason(self) -> Self:
        complete = self.checksum_algorithm is not None and self.checksum is not None
        if complete == (self.missing_reason is not None):
            raise ValueError("artifact needs either a complete checksum or a missing reason")
        if self.checksum_algorithm == "md5" and len(self.checksum or "") != 32:
            raise ValueError("MD5 checksum must have 32 hexadecimal characters")
        if self.checksum_algorithm == "sha256" and len(self.checksum or "") != 64:
            raise ValueError("SHA-256 checksum must have 64 hexadecimal characters")
        if self.checksum is not None and any(
            char not in "0123456789abcdef" for char in self.checksum
        ):
            raise ValueError("checksum must use lowercase hexadecimal characters")
        return self


class AuthorizedAssay(StrictModel):
    assay_id: str = Field(min_length=1)
    assay_type: str = Field(min_length=1)
    platform: str | None = None
    quality_fields: dict[str, Any]
    outcomes: dict[str, Any]
    artifacts: list[AuthorizedArtifact]


class MissingField(StrictModel):
    field: str = Field(min_length=1)
    reason: str = Field(min_length=1)


class AuthorizedRecord(StrictModel):
    record_id: str = Field(min_length=1)
    study_accession: Literal["phs001304.v1.p1"]
    substudy_accession: str = Field(pattern=r"^phs0016(?:34|35|36|37|38|39|40)\.v1\.p1$")
    participant_id: str = Field(min_length=1)
    specimen_id: str = Field(min_length=1)
    block_id: str = Field(min_length=1)
    aliquot_id: str = Field(min_length=1)
    parent_specimen_id: str | None = None
    matched_specimen_id: str | None = None
    matched_aliquot_id: str | None = None
    material: str = Field(min_length=1)
    cold_ischemia_minutes: float | None = Field(default=None, ge=0)
    fixation_duration_minutes: float | None = Field(default=None, ge=0)
    freezing_method: str | None = None
    storage_temperature: str | None = None
    storage_duration: str | None = None
    embedding: str | None = None
    collection_site: str | None = None
    pathology_review: dict[str, Any]
    publisher_role: str | None = None
    assays: list[AuthorizedAssay] = Field(min_length=1)
    missing_fields: list[MissingField]
    source_references: list[SourceReference] = Field(min_length=1)
