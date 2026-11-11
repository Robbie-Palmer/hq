from __future__ import annotations

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

PreparationToken = Literal["Fresh", "Form", "FFPE", "FFPE-Kit"]
RegionToken = Literal["Cx", "HC"]
RegionName = Literal["prefrontal cortex", "hippocampus"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class DatasetContract(StrictModel):
    accession: Literal["PXD064700"]
    revision: Literal[1]
    announce_date: Literal["2026-03-17"]
    announcement_datetime: str
    title: str = Field(min_length=1)
    hosting_repository: Literal["PRIDE"]
    submission_type: Literal["PARTIAL"]
    dataset_origin: Literal["Original data"]
    review_level: Literal["Peer-reviewed dataset"]
    repository_support: Literal["Unsupported dataset by repository"]
    doi: Literal["10.1016/J.JPROT.2025.105589"]


class RightsContract(StrictModel):
    dataset_license: Literal["Creative Commons Public Domain (CC0)"]
    dataset_license_spdx: Literal["CC0-1.0"]
    dataset_license_url: HttpUrl
    article_license: Literal["CC BY 4.0"]
    article_license_url: HttpUrl


class PublisherRole(StrictModel):
    name: str = Field(min_length=1)
    role: Literal["dataset submitter", "lab head"]
    affiliation: str = Field(min_length=1)
    orcid: str | None


class AssayContract(StrictModel):
    organism: str
    organism_accession: str
    organism_part: str
    organism_part_accession: str
    instrument: Literal["Orbitrap Exploris 480"]
    instrument_accession: Literal["MS:1003028"]
    acquisition: Literal["Data-independent acquisition"]
    proteomics_type: Literal["Bottom-up proteomics"]
    quantification: Literal["label-free quantification"]
    search_software: Literal["DIA-NN 1.8"]
    analysis_software: list[str]
    search_fdr: Literal["1 %"]
    repository_modification_statement: Literal["No PTMs are included in the dataset"]


class StudyContext(StrictModel):
    material: Literal["post-mortem human brain tissue"]
    published_age_range_years: Literal["64-101"]
    regions: dict[RegionToken, RegionName]
    preparation_comparison_donors: Literal[6]
    commercial_ffpe_kit_comparison_donors: Literal[4]
    braak_pilot: str
    donor_specific_age_sex_braak_or_diagnosis_published_in_repository_metadata: Literal[False]


class PreparationContract(StrictModel):
    filename_token: PreparationToken
    preservation: str
    extraction: str


class ArtifactPolicy(StrictModel):
    mode: Literal["metadata_only"]
    commit_proteomics_payloads: Literal[False]
    requires_credentials: Literal[False]
    publisher_checksum_algorithm: Literal["sha1"]


class SourceBoundaries(StrictModel):
    supported_uses: list[str]
    downstream_only: list[str]
    unsupported_uses: list[str]
    unpublished_fields_not_inferred: list[str]


class SourceContract(StrictModel):
    schema_version: Literal["1.0.0"]
    product_id: str
    dataset: DatasetContract
    rights: RightsContract
    publisher_roles: list[PublisherRole] = Field(min_length=2, max_length=2)
    assay: AssayContract
    study_context: StudyContext
    preparations: list[PreparationContract] = Field(min_length=4, max_length=4)
    artifact_policy: ArtifactPolicy
    source_boundaries: SourceBoundaries

    @model_validator(mode="after")
    def native_identities_are_unique(self) -> Self:
        if {item.role for item in self.publisher_roles} != {"dataset submitter", "lab head"}:
            raise ValueError("publisher roles must retain the submitter and lab head")
        tokens = [item.filename_token for item in self.preparations]
        if len(tokens) != len(set(tokens)):
            raise ValueError("preparation filename tokens must be unique")
        return self


class SnapshotFile(StrictModel):
    path: str = Field(min_length=1)
    bytes: int = Field(ge=1)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class SnapshotManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    product_id: str
    retrieved_at: str
    acquisition_mode: Literal["public_metadata_only"]
    requires_credentials: Literal[False]
    files: list[SnapshotFile] = Field(min_length=1)


class FtpEntry(StrictModel):
    file_name: str = Field(min_length=1)
    bytes: int = Field(ge=1)
    locator: str = Field(min_length=1)


class ArtifactRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    artifact_ref: str
    file_name: str
    native_artifact_role: str
    bytes: int
    locator: str
    announcement_file_id: str | None
    announcement_category: str | None
    announcement_category_accession: str | None
    sha1: str | None
    checksum_source_path: str | None
    checksum_basename_matches_listing: bool | None
    missing_checksum_reason: str | None
    availability: Literal["metadata_reference_only"] = "metadata_reference_only"

    @model_validator(mode="after")
    def checksum_fields_agree(self) -> Self:
        present = (self.sha1 is not None, self.checksum_source_path is not None)
        if present[0] != present[1]:
            raise ValueError("checksum and checksum source path must appear together")
        if self.sha1 is None and self.missing_checksum_reason is None:
            raise ValueError("an unchecksummed artifact must explain the gap")
        if self.sha1 is not None and self.missing_checksum_reason is not None:
            raise ValueError("a checksummed artifact cannot declare a missing reason")
        return self


class RunRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    run_ref: str
    run_name: str
    raw_artifact_ref: str
    quant_artifact_ref: str
    case_number: int = Field(ge=1, le=8)
    body_donor_number: str
    brain_region_token: RegionToken
    brain_region: RegionName
    preparation_token: PreparationToken
    preservation: str
    extraction: str
    batch: str
    injection_marker: str | None
    biological_replicate: int = Field(ge=1, le=3)
    technical_replicate: int = Field(ge=1, le=2)
    acquisition_date: str
    file_naming_variants: list[str]
    sdrf_annotation_provenance: Literal["PRIDE community annotation; submitter-unverified"]
    sdrf_native: list[dict[str, str]]
    instrument: Literal["Orbitrap Exploris 480"]
    acquisition: Literal["Data-independent acquisition"]
    quantification: Literal["label-free quantification"]


class PairingRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    pairing_ref: str
    case_number: int
    body_donor_number: str
    brain_region_token: RegionToken
    brain_region: str
    biological_replicate: int
    pairing_basis: Literal["publisher filename donor, region, and biological-replicate tokens"]
    physical_specimen_identity_asserted: Literal[False]
    run_refs_by_preparation: dict[str, list[str]]
