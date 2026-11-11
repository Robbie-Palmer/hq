from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Self

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator

MD5_PATTERN = r"^[0-9a-f]{32}$"
CASE_PATTERN = r"^YW_DP[1-5]_[0-9]{3}$"

Preparation = Literal["frozen", "ffpe"]
ArtifactRole = Literal["mrxs_named_slide_file", "scanner_metadata_xml", "annotation_xml"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Creator(StrictModel):
    name: Literal["Eom, Minseob"]
    affiliation: Literal["Yonsei University Wonju College of Medicine"]
    orcid: Literal["0000-0002-8121-8399"]


class SourceReference(StrictModel):
    publisher: Literal["Zenodo"]
    record_id: Literal[18780726]
    doi: Literal["10.5281/zenodo.18780726"]
    record_url: AnyHttpUrl
    api_url: AnyHttpUrl
    published_at: date
    updated_at: datetime
    creator: Creator
    access_right: Literal["open"]
    retrieved_at: date

    @model_validator(mode="after")
    def require_publisher_dates(self) -> Self:
        if self.published_at != date(2026, 2, 26):
            raise ValueError("the Zenodo publication date differs from the pinned record")
        return self


class License(StrictModel):
    name: str = Field(min_length=1)
    spdx_id: Literal["CC-BY-4.0", "CC-BY-NC-ND-4.0"]
    url: AnyHttpUrl
    scope: str = Field(min_length=1)


class FullStudyRights(StrictModel):
    public: Literal[False]
    terms: str = Field(min_length=1)


class Rights(StrictModel):
    preview_dataset: License
    paper: License
    full_study_data: FullStudyRights

    @model_validator(mode="after")
    def require_distinct_rights(self) -> Self:
        if self.preview_dataset.spdx_id != "CC-BY-4.0":
            raise ValueError("the Zenodo preview must retain CC BY 4.0")
        if self.paper.spdx_id != "CC-BY-NC-ND-4.0":
            raise ValueError("the paper must retain CC BY-NC-ND 4.0")
        return self


class PreviewCase(StrictModel):
    case_id: str = Field(pattern=CASE_PATTERN)
    publisher_folder: Literal["DP1_EMPD", "DP2_BOWEN", "DP3_SCC", "DP4_BCC", "DP5_melanoma"]
    subtype: Literal[
        "extramammary Paget disease",
        "Bowen disease",
        "invasive squamous cell carcinoma",
        "basal cell carcinoma",
        "melanoma",
    ]
    frozen_stem: str = Field(pattern=CASE_PATTERN)
    ffpe_stem: str

    @model_validator(mode="after")
    def require_preparation_names(self) -> Self:
        if self.frozen_stem != self.case_id or self.ffpe_stem != f"{self.case_id}P":
            raise ValueError("preparation stems must preserve the publisher P suffix semantics")
        return self


class PreviewCorpus(StrictModel):
    case_count: Literal[5]
    preparation_pair_count: Literal[5]
    file_count: Literal[30]
    total_bytes: Literal[418147]
    context: Literal["skin cancer resection margins"]
    publisher_role: Literal["qualitative reference and reproducibility checks"]
    deidentified: Literal[True]
    spatial_registration: Literal[False]
    identical_cutting_plane: Literal[False]
    partition: None
    cases: list[PreviewCase]

    @model_validator(mode="after")
    def require_five_publisher_cases(self) -> Self:
        case_ids = {case.case_id for case in self.cases}
        subtypes = {case.subtype for case in self.cases}
        if len(self.cases) != 5 or len(case_ids) != 5 or len(subtypes) != 5:
            raise ValueError("the preview must contain five unique cases and subtypes")
        return self


class SourceFile(StrictModel):
    name: str = Field(min_length=1)
    bytes: int = Field(gt=0)
    md5: str = Field(pattern=MD5_PATTERN)
    case_id: str = Field(pattern=CASE_PATTERN)
    preparation: Preparation
    role: ArtifactRole


class ImageReadiness(StrictModel):
    status: Literal["metadata_only_source_defect"]
    checked_at: date
    publisher_claim: str = Field(min_length=1)
    observed_mrxs_payload: str = Field(min_length=1)
    companion_pixel_directories_present: Literal[False]
    annotation_payload: str = Field(min_length=1)
    reader: Literal["OpenSlide"]
    reader_result: str = Field(min_length=1)
    handling: str = Field(min_length=1)


class StudySites(StrictModel):
    primary: str = Field(min_length=1)
    external_validation: str = Field(min_length=1)


class Preparations(StrictModel):
    frozen: str = Field(min_length=1)
    ffpe: str = Field(min_length=1)


class SectionRelation(StrictModel):
    relationship: Literal["adjacent, non-identical tissue levels"]
    spatial_registration: Literal[False]
    published_mismatch: str = Field(min_length=1)


class DiagnosticDiscrepancy(StrictModel):
    extension_definition: str = Field(min_length=1)
    grades: list[Literal["concordant", "minimal", "minor", "major"]]
    minimal_count: Literal[30]
    minor_count: Literal[14]
    major_count: Literal[16]
    total_count: Literal[60]
    expert_reassessment_case_count: Literal[55]
    expert_roles: list[
        Literal[
            "board-certified pathologist",
            "board-certified dermatologist",
        ]
    ]
    major_definition: str = Field(min_length=1)

    @model_validator(mode="after")
    def require_published_diagnostic_facts(self) -> Self:
        if self.grades != ["concordant", "minimal", "minor", "major"]:
            raise ValueError("diagnostic grades must retain publisher order")
        if self.minimal_count + self.minor_count + self.major_count != self.total_count:
            raise ValueError("diagnostic discrepancy counts do not sum to the paper total")
        if (
            self.expert_roles.count("board-certified pathologist") != 2
            or self.expert_roles.count("board-certified dermatologist") != 1
        ):
            raise ValueError("the reassessment must retain two pathologists and one dermatologist")
        return self


class Workflow(StrictModel):
    measurement_basis: Literal["five slides per case at the primary institution"]
    frozen_preparation_minutes: Literal[8]
    frozen_time_qualifier: Literal["approximately"]
    standard_ffpe_processing_hours_minimum: Literal[24]
    standard_ffpe_time_qualifier: Literal["more than"]


class StudyRoles(StrictModel):
    model_partition: str = Field(min_length=1)
    external_validation: str = Field(min_length=1)
    clinical_reassessment: str = Field(min_length=1)


class PaperContext(StrictModel):
    doi: Literal["10.1038/s41746-026-02939-1"]
    title: str = Field(min_length=1)
    publication_date: date
    study_sites: StudySites
    collection_period: Literal["2010-01-01 through 2023-12-31"]
    patient_count: Literal[283]
    total_slide_count: Literal[2594]
    paired_frozen_ffpe_slide_count: Literal[1192]
    additional_main_tumor_ffpe_slide_count: Literal[210]
    preview_contains_full_cohort: Literal[False]
    scanner: Literal["PANNORAMIC 250 Flash III, 3DHistech Ltd, Budapest, Hungary"]
    scan_magnification: Literal["40x"]
    specimen_context: Literal["skin cancer resection margins"]
    preparations: Preparations
    section_relation: SectionRelation
    diagnostic_discrepancy: DiagnosticDiscrepancy
    workflow: Workflow
    roles: StudyRoles
    full_data_access: str = Field(min_length=1)

    @model_validator(mode="after")
    def require_paper_date(self) -> Self:
        if self.publication_date != date(2026, 6, 29):
            raise ValueError("the paper publication date differs from the cited article")
        return self


class Interfaces(StrictModel):
    record_reference_template: Literal["skin-frozen-ffpe-preview:<case-id>:<preparation>"]
    artifact_reference_template: Literal["skin-frozen-ffpe-preview:<filename>"]
    native_index_path: Literal["outputs/native-index.jsonl"]
    availability: Literal["metadata_only"]
    ownership: str = Field(min_length=1)


class SourceManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["skin-frozen-ffpe-preview-zenodo-18780726-v1"]
    title: str = Field(min_length=1)
    source: SourceReference
    rights: Rights
    preview: PreviewCorpus
    files: list[SourceFile]
    image_readiness: ImageReadiness
    paper_context: PaperContext
    interfaces: Interfaces

    @model_validator(mode="after")
    def require_complete_file_inventory(self) -> Self:
        names = [item.name for item in self.files]
        if len(self.files) != 30 or len(names) != len(set(names)):
            raise ValueError("the Zenodo file inventory must contain 30 unique files")
        if sum(item.bytes for item in self.files) != self.preview.total_bytes:
            raise ValueError("file sizes do not sum to the pinned Zenodo total")
        case_ids = {case.case_id for case in self.preview.cases}
        if {item.case_id for item in self.files} != case_ids:
            raise ValueError("file inventory and preview cases differ")
        for case in self.preview.cases:
            case_files = [item for item in self.files if item.case_id == case.case_id]
            for preparation in ("frozen", "ffpe"):
                roles = {item.role for item in case_files if item.preparation == preparation}
                if roles != {
                    "mrxs_named_slide_file",
                    "scanner_metadata_xml",
                    "annotation_xml",
                }:
                    raise ValueError("each case preparation must retain its three source files")
        return self


class NativeArtifact(StrictModel):
    artifact_ref: str = Field(min_length=1)
    filename: str = Field(min_length=1)
    role: ArtifactRole
    bytes: int = Field(gt=0)
    md5: str = Field(pattern=MD5_PATTERN)
    retrieval_url: AnyHttpUrl


class NativeRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: Literal["skin-frozen-ffpe-preview-zenodo-18780726-v1"]
    record_ref: str = Field(min_length=1)
    case_id: str = Field(pattern=CASE_PATTERN)
    publisher_folder: str = Field(min_length=1)
    subtype: str = Field(min_length=1)
    specimen_context: Literal["skin cancer resection margins"]
    preparation: Preparation
    source_role: Literal["qualitative reference and reproducibility checks"]
    publisher_partition: None
    paired_case_ref: str = Field(min_length=1)
    pairing_basis: Literal["publisher-declared same case"]
    spatial_registration: Literal[False]
    identical_cutting_plane: Literal[False]
    availability: Literal["metadata_only"]
    usable_wsi: Literal[False]
    pixel_payload_status: Literal["missing companion MRXS pixel directory"]
    annotation_status: Literal["empty annotations element"]
    artifacts: list[NativeArtifact]

    @model_validator(mode="after")
    def require_three_metadata_artifacts(self) -> Self:
        if len(self.artifacts) != 3 or {item.role for item in self.artifacts} != {
            "mrxs_named_slide_file",
            "scanner_metadata_xml",
            "annotation_xml",
        }:
            raise ValueError("native records require all three publisher file identities")
        return self
