from __future__ import annotations

from datetime import date
from typing import Literal, Self

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, field_validator, model_validator

SHA256_PATTERN = r"^[0-9a-f]{64}$"
ProviderId = Literal["radboud", "karolinska"]
ArtifactKind = Literal["whole_slide", "label_mask"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SourceRecord(StrictModel):
    record_id: str = Field(min_length=1)
    role: Literal["challenge_and_rights_record", "distribution_and_label_record"]
    url: AnyHttpUrl
    snapshot_path: str = Field(min_length=1)
    snapshot_sha256: str = Field(pattern=SHA256_PATTERN)
    retrieved_at: date


class Access(StrictModel):
    policy: Literal["operator_accepts_kaggle_competition_rules"]
    authentication_required: Literal[True]
    competition_rules_acceptance_required: Literal[True]
    automated_acquisition: Literal[False]
    public_ci_access: Literal[False]
    instructions: str = Field(min_length=1)


class Rights(StrictModel):
    license_name_as_published: Literal["CC BY-SA-NC 4.0"]
    spdx_id: Literal["CC-BY-NC-SA-4.0"]
    deed_url: AnyHttpUrl
    evidence_url: AnyHttpUrl
    attribution: str = Field(min_length=1)
    scope: str = Field(min_length=1)


class Distribution(StrictModel):
    competition_ref: Literal["prostate-cancer-grade-assessment"]
    publisher_role: Literal["train"]
    reported_files: Literal[21135]
    reported_bytes_decimal: Literal[411900000000]
    development_slides: Literal[10616]
    development_masks: Literal[10516]
    development_patients: Literal[2113]
    metadata_file: Literal["train.csv"]
    metadata_fields: list[Literal["image_id", "data_provider", "isup_grade", "gleason_score"]]
    slide_path_template: Literal["train_images/{image_id}.tiff"]
    mask_path_template: Literal["train_label_masks/{image_id}_mask.tiff"]
    stain: Literal["hematoxylin and eosin"]
    format: Literal["multi-level TIFF"]


class Provider(StrictModel):
    provider_id: ProviderId
    institution: str = Field(min_length=1)
    development_slide_count: int = Field(gt=0)
    scan_magnification: Literal["20x"]
    source_scan_micrometres_per_pixel: list[float] = Field(min_length=1)
    published_tiff_micrometres_per_pixel: list[float] = Field(min_length=1)
    scanner_vendors: list[str] = Field(default_factory=list)
    mask_annotation_unit: str = Field(min_length=1)
    mask_codes: dict[int, str] = Field(min_length=3)

    @model_validator(mode="after")
    def require_native_mask_domain(self) -> Self:
        expected = set(range(6)) if self.provider_id == "radboud" else set(range(3))
        if set(self.mask_codes) != expected:
            raise ValueError(f"{self.provider_id} mask codes differ from the Kaggle record")
        return self


class Labels(StrictModel):
    isup_grade_values: list[Literal[0, 1, 2, 3, 4, 5]]
    gleason_score_field: Literal["gleason_score"]
    provider_field: Literal["data_provider"]
    caveats: list[str] = Field(min_length=4)


class Identities(StrictModel):
    published_identity: Literal["image_id"]
    patient_identity_available_in_distribution: Literal[False]
    case_identity_available_in_distribution: Literal[False]
    policy: str = Field(min_length=1)


class Interfaces(StrictModel):
    record_reference_template: Literal["panda:{image_id}"]
    artifact_reference_template: Literal["panda:{image_id}:{artifact_kind}"]
    artifact_kinds: list[ArtifactKind]
    private_native_index_path: Literal["outputs/private/native-index.jsonl"]
    private_artifact_index_path: Literal["outputs/private/artifact-references.jsonl"]
    ownership: str = Field(min_length=1)


class Checksums(StrictModel):
    algorithm: Literal["sha256"]
    evidence_snapshots: str = Field(min_length=1)
    authorized_artifacts: str = Field(min_length=1)


class SourceManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["panda-prostate-cancer-grade-assessment-2020"]
    title: str = Field(min_length=1)
    dataset_version: Literal["2020-04-21-kaggle-competition-release"]
    version_basis: str = Field(min_length=1)
    source_records: list[SourceRecord]
    paper_doi: Literal["10.1038/s41591-021-01620-2"]
    citation: str = Field(min_length=1)
    access: Access
    rights: Rights
    distribution: Distribution
    providers: list[Provider]
    labels: Labels
    identities: Identities
    interfaces: Interfaces
    checksums: Checksums

    @model_validator(mode="after")
    def require_complete_source_contract(self) -> Self:
        if {item.role for item in self.source_records} != {
            "challenge_and_rights_record",
            "distribution_and_label_record",
        }:
            raise ValueError("PANDA must pin the Grand Challenge and Kaggle records")
        provider_counts = {
            item.provider_id: item.development_slide_count for item in self.providers
        }
        if provider_counts != {"radboud": 5160, "karolinska": 5456}:
            raise ValueError("provider counts differ from the 10,616-slide development release")
        if self.labels.isup_grade_values != [0, 1, 2, 3, 4, 5]:
            raise ValueError("PANDA ISUP grades must preserve the published 0-5 domain")
        if self.interfaces.artifact_kinds != ["whole_slide", "label_mask"]:
            raise ValueError("PANDA artifact reference kinds are incomplete")
        return self


class ArtifactReference(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: Literal["panda-prostate-cancer-grade-assessment-2020"]
    artifact_ref: str = Field(min_length=1)
    image_id: str = Field(min_length=1)
    kind: ArtifactKind
    publisher_path: str = Field(min_length=1)
    original_reference: str = Field(pattern=r"^kaggle://competitions/")
    local_path: str = Field(min_length=1)
    bytes: int = Field(gt=0)
    sha256: str = Field(pattern=SHA256_PATTERN)
    format: Literal["multi-level TIFF"]

    @field_validator("publisher_path", "local_path")
    @classmethod
    def require_normalized_relative_path(cls, value: str) -> str:
        parts = value.split("/")
        if value.startswith("/") or ".." in parts or "." in parts or "" in parts:
            raise ValueError("artifact paths must be normalized relative paths")
        return value


class MaskAnnotation(StrictModel):
    available: bool
    annotation_unit: str = Field(min_length=1)
    native_codes: dict[int, str] = Field(min_length=3)
    artifact_ref: str | None

    @model_validator(mode="after")
    def require_availability_reference(self) -> Self:
        if self.available != (self.artifact_ref is not None):
            raise ValueError("mask availability and artifact reference differ")
        return self


class ProviderScale(StrictModel):
    source_scan_magnification: Literal["20x"]
    source_scan_micrometres_per_pixel: list[float] = Field(min_length=1)
    published_tiff_micrometres_per_pixel: list[float] = Field(min_length=1)
    scanner_vendors: list[str]
    basis: Literal["official_challenge_record_provider_level"]


class NativeRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: Literal["panda-prostate-cancer-grade-assessment-2020"]
    record_ref: str = Field(min_length=1)
    image_id: str = Field(min_length=1)
    slide_id: str = Field(min_length=1)
    patient_id: None
    case_id: None
    identity_status: Literal["patient_and_case_ids_not_published"]
    data_provider: ProviderId
    institution: str = Field(min_length=1)
    publisher_role: Literal["train"]
    stain: Literal["hematoxylin and eosin"]
    gleason_score: str = Field(min_length=1)
    isup_grade: Literal[0, 1, 2, 3, 4, 5]
    provider_scale: ProviderScale
    mask_annotation: MaskAnnotation
    whole_slide_artifact_ref: str = Field(min_length=1)


class PublicMetrics(StrictModel):
    dataset_id: str
    dataset_version: str
    development_patient_count: int
    development_slide_count: int
    development_mask_count: int
    provider_slide_counts: dict[str, int]
    source_record_count: int


class PrivateMetrics(StrictModel):
    dataset_id: str
    artifact_count: int
    mask_count: int
    provider_slide_counts: dict[str, int]
    record_count: int
    train_csv_bytes: int
    train_csv_sha256: str = Field(pattern=SHA256_PATTERN)
