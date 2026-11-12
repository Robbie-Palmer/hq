from __future__ import annotations

from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

Repository = Literal["TCIA", "PDC", "GDC"]
AccessTier = Literal["public", "open", "controlled", "mixed"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class CohortContract(StrictModel):
    publisher: str = Field(min_length=1)
    collection_id: str = Field(min_length=1)
    disease_type: str = Field(min_length=1)
    participant_identity_statement_url: HttpUrl


class RepositoryContract(StrictModel):
    repository: Repository
    release: str = Field(min_length=1)
    access_tier: AccessTier
    license: str = Field(min_length=1)
    license_url: HttpUrl
    policy_url: HttpUrl
    metadata_url: HttpUrl


class ArtifactPolicy(StrictModel):
    mode: Literal["metadata_only"]
    commit_artifact_bytes: Literal[False]
    controlled_downloads: Literal[False]
    tcia_slide_stain: Literal["H&E"]
    tcia_slide_stain_evidence_url: HttpUrl


class SourceContract(StrictModel):
    schema_version: Literal["1.0.0"]
    product_id: str = Field(min_length=1)
    cohort: CohortContract
    repositories: list[RepositoryContract] = Field(min_length=3, max_length=3)
    pdc_study_ids: list[str] = Field(min_length=1)
    artifact_policy: ArtifactPolicy

    @model_validator(mode="after")
    def repository_contracts_are_complete(self) -> Self:
        repositories = [item.repository for item in self.repositories]
        if set(repositories) != {"TCIA", "PDC", "GDC"} or len(repositories) != 3:
            raise ValueError("source contract must declare TCIA, PDC, and GDC once")
        if len(self.pdc_study_ids) != len(set(self.pdc_study_ids)):
            raise ValueError("PDC study identifiers must be unique")
        return self


class SnapshotFile(StrictModel):
    path: str = Field(min_length=1)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    records: int = Field(ge=1)


class PdcVersion(StrictModel):
    pdc_study_id: str
    study_id: str
    study_version: str
    is_latest_version: str


class SnapshotManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    product_id: str
    retrieved_at: str
    tcia_collection_version: str
    tcia_collection_modified_gmt: str
    pdc_versions: list[PdcVersion]
    gdc_data_release: str
    gdc_data_release_version: str
    files: list[SnapshotFile] = Field(min_length=1)


class NativeRecord(StrictModel):
    repository: Repository
    native_id: str = Field(min_length=1)
    native: dict[str, Any]


class ArtifactReference(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    artifact_ref: str = Field(min_length=1)
    repository: Repository
    native_id: str = Field(min_length=1)
    participant_ids: list[str]
    specimen_ids: list[str]
    study_ref: str | None = None
    file_name: str | None = None
    format: str | None = None
    assay: str | None = None
    assay_evidence: str | None = None
    bytes: int | None = Field(default=None, ge=0)
    checksum_algorithm: Literal["md5"] | None = None
    checksum: str | None = None
    access_tier: Literal["public", "open", "controlled"]
    locator: str = Field(min_length=1)
    availability: Literal["metadata_only"] = "metadata_only"
    missing_checksum_reason: str | None = None

    @model_validator(mode="after")
    def checksum_fields_agree(self) -> Self:
        if (self.checksum_algorithm is None) != (self.checksum is None):
            raise ValueError("checksum algorithm and value must both be present or absent")
        if self.checksum is None and self.missing_checksum_reason is None:
            raise ValueError("artifacts without a checksum must explain its absence")
        if self.checksum is not None and self.missing_checksum_reason is not None:
            raise ValueError("artifacts with a checksum cannot declare a missing reason")
        return self


class SpecimenLink(StrictModel):
    tcia_specimen_id: str
    pdc_sample_refs: list[str]
    gdc_sample_refs: list[str]
    match_method: Literal["exact_submitter_id"]


class ParticipantMissingness(StrictModel):
    tcia_slide: bool
    pdc_proteomic_study: bool
    gdc_case: bool
    gdc_genomic_file: bool


class ParticipantLink(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    product_id: str
    participant_ref: str
    publisher_participant_id: str
    tumour_type: str
    tcia_collection_id: str
    tcia_slide_refs: list[str]
    pdc_case_refs: list[str]
    pdc_clinical_refs: list[str]
    pdc_study_refs: list[str]
    gdc_case_refs: list[str]
    gdc_file_refs: list[str]
    specimen_links: list[SpecimenLink]
    missingness: ParticipantMissingness
    linkage_evidence: list[str] = Field(min_length=1)
