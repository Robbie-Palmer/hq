from __future__ import annotations

from typing import Literal, Self

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator

CellClassName = Literal["Epithelial", "Lymphocyte", "Macrophage", "Neutrophil", "Ambiguous"]
PublisherSplit = Literal["training", "testing"]
PublisherRole = Literal[
    "challenge_scored_nucleus", "challenge_excluded_region", "empty_annotation_group"
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class License(StrictModel):
    spdx_id: Literal["CC-BY-NC-SA-4.0"]
    name: str = Field(min_length=1)
    url: AnyHttpUrl
    evidence_url: AnyHttpUrl
    redistribution: str = Field(min_length=1)


class ChecksumEvidence(StrictModel):
    method: str = Field(min_length=1)
    observed_at: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    limitation: str = Field(min_length=1)


class SourceImages(StrictModel):
    origin: Literal["The Cancer Genome Atlas data portal"]
    stain: Literal["H&E"]
    scanner_magnification: Literal["40x"]


class AnnotationProtocol(StrictModel):
    tool: Literal["Aperio ImageScope"]
    initial_annotator_role: Literal["engineering graduate student"]
    quality_control_role: Literal["expert pathologist"]
    quality_control_target: str = Field(min_length=1)
    test_role_semantics: str = Field(min_length=1)
    per_instance_annotator_identity_available: Literal[False]
    evidence: AnyHttpUrl


class CellClass(StrictModel):
    name: CellClassName
    publisher_role: Literal["challenge_scored_nucleus", "challenge_excluded_region"]


class SourceArtifact(StrictModel):
    name: Literal["training", "testing", "organ_roles"]
    kind: Literal["dataset_archive", "organ_evidence"]
    publisher_split: PublisherSplit | None
    google_drive_file_id: str = Field(pattern=r"^[A-Za-z0-9_-]+$")
    publisher_url: AnyHttpUrl
    download_url: AnyHttpUrl
    filename: str = Field(min_length=1)
    bytes: int = Field(gt=0)
    md5: str = Field(pattern=r"^[0-9a-f]{32}$")
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    last_modified: str = Field(min_length=1)

    @property
    def artifact_ref(self) -> str:
        return f"monusac2020-challenge-distribution-20210608:artifact:{self.name}"

    @model_validator(mode="after")
    def require_role_for_dataset_archive(self) -> Self:
        if (self.kind == "dataset_archive") != (self.publisher_split is not None):
            raise ValueError("only dataset archives have publisher split roles")
        return self


class ExpectedSplit(StrictModel):
    patient_role_count: int = Field(gt=0)
    image_count: int = Field(gt=0)
    svs_count: int = Field(gt=0)
    tif_count: int = Field(ge=0)
    xml_count: int = Field(gt=0)
    scored_instance_count: int = Field(gt=0)
    ambiguous_instance_count: int = Field(ge=0)
    cell_class_counts: dict[CellClassName, int]


class ExpectedCorpus(StrictModel):
    organs: list[Literal["Breast", "Kidney", "Lung", "Prostate"]]
    training: ExpectedSplit
    testing: ExpectedSplit


class SourceManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["monusac2020-challenge-distribution-20210608"]
    title: str = Field(min_length=1)
    source_version: str = Field(min_length=1)
    publisher: Literal["MoNuSAC 2020 Grand Challenge"]
    publisher_record: AnyHttpUrl
    paper_doi: Literal["10.1109/TMI.2021.3085712"]
    citation: str = Field(min_length=1)
    license: License
    checksum_evidence: ChecksumEvidence
    source_images: SourceImages
    annotation_protocol: AnnotationProtocol
    cell_classes: list[CellClass]
    artifacts: list[SourceArtifact]
    expected: ExpectedCorpus

    @model_validator(mode="after")
    def require_complete_native_contract(self) -> Self:
        if {item.name for item in self.cell_classes} != {
            "Epithelial",
            "Lymphocyte",
            "Macrophage",
            "Neutrophil",
            "Ambiguous",
        }:
            raise ValueError("MoNuSAC native cell classes are incomplete")
        if {artifact.name for artifact in self.artifacts} != {
            "training",
            "testing",
            "organ_roles",
        }:
            raise ValueError("MoNuSAC training, testing, and organ evidence artifacts are required")
        if self.expected.organs != ["Breast", "Kidney", "Lung", "Prostate"]:
            raise ValueError("MoNuSAC organs must retain the publisher order")
        return self


class PatientRole(StrictModel):
    publisher_split: PublisherSplit
    patient_id: str = Field(pattern=r"^TCGA-[A-Z0-9]{2}-[A-Z0-9]{4}$")
    organ: Literal["Breast", "Kidney", "Lung", "Prostate"]
    tissue_source_site_code: str = Field(pattern=r"^[A-Z0-9]{2}$")
    hospital: str = Field(min_length=1)


class OrganRoleContract(StrictModel):
    schema_version: Literal["1.0.0"]
    evidence_artifact: Literal["MoNuSAC_Supplementary_material.pdf"]
    evidence_location: Literal["Table S1"]
    patient_roles: list[PatientRole]

    @model_validator(mode="after")
    def require_unique_role_rows(self) -> Self:
        keys = [(role.publisher_split, role.patient_id) for role in self.patient_roles]
        if len(keys) != len(set(keys)):
            raise ValueError("publisher patient-role rows must be unique")
        return self


class ArtifactEvidence(StrictModel):
    artifact_ref: str
    filename: str
    bytes: int
    md5: str
    sha256: str


class AcquisitionEvidence(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: str
    artifacts: list[ArtifactEvidence]


class RemoteArtifactEvidence(StrictModel):
    artifact_ref: str
    final_url: str
    filename: str
    bytes: int
    last_modified: str


class Vertex(StrictModel):
    x: float
    y: float
    z: float


class NativeInstanceAnnotation(StrictModel):
    annotation_group_id: int
    annotation_group_name: str
    source_attribute_name: str
    cell_class: CellClassName
    publisher_role: Literal["challenge_scored_nucleus", "challenge_excluded_region"]
    region_id: int
    region_type: int
    negative_roa: bool
    length: float | None
    area: float | None
    length_microns: float | None
    area_microns: float | None
    vertices: list[Vertex] = Field(min_length=1)


class NativeAnnotationGroup(StrictModel):
    annotation_group_id: int
    annotation_group_name: str
    source_attribute_name: str
    cell_class: CellClassName | None
    publisher_role: PublisherRole
    line_color: int
    instance_count: int = Field(ge=0)


class NativeImageMember(StrictModel):
    format: Literal["svs", "tif"]
    artifact_ref: str
    member_path: str


class NativeImageRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: Literal["monusac2020-challenge-distribution-20210608"]
    record_ref: str
    image_id: str
    slide_id: str
    patient_id: str
    publisher_split: PublisherSplit
    organ: Literal["Breast", "Kidney", "Lung", "Prostate"]
    tissue_source_site_code: str
    hospital: str
    image_members: list[NativeImageMember]
    annotation_artifact_ref: str
    annotation_member_path: str
    microns_per_pixel: float = Field(gt=0)
    annotation_groups: list[NativeAnnotationGroup]
    instance_count: int = Field(ge=0)
    cell_class_counts: dict[str, int]
    publisher_role_counts: dict[str, int]
    per_instance_annotator_identity_available: Literal[False] = False
