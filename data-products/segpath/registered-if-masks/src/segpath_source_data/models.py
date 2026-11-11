from __future__ import annotations

from typing import Literal, Self

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator

SourceRole = Literal["train", "val", "test"]
MaskDerivation = Literal[
    "if_positive_signal",
    "if_positive_and_he_red_signal",
    "if_positive_transferred_to_dapi_nucleus",
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Paper(StrictModel):
    doi: Literal["10.1016/j.patter.2023.100688"]
    url: AnyHttpUrl


class License(StrictModel):
    spdx_id: Literal["CC-BY-NC-SA-4.0"]
    name: str = Field(min_length=1)
    url: AnyHttpUrl
    evidence_url: AnyHttpUrl
    commercial_use_contact: str = Field(pattern=r"^[^@]+@[^@]+$")


class ImageContract(StrictModel):
    width_pixels: Literal[984]
    height_pixels: Literal[984]
    micrometers_per_pixel: float = Field(ge=0.220818, le=0.220818)
    magnification: Literal["40x"]
    wsi_coordinate_origin: Literal["top_left"]
    filename_coordinates: Literal["leftmost WSI position"]


class RegistrationSignals(StrictModel):
    fixed: Literal["H&E hematoxylin component"]
    moving: Literal["IF DAPI nuclear channel"]


class AnnotationProvenance(StrictModel):
    input_stain: Literal["H&E"]
    same_section_restaining: Literal[True]
    restaining: str = Field(min_length=1)
    registration: list[str] = Field(min_length=3)
    registration_signals: RegistrationSignals
    published_artifacts: list[Literal["H&E image", "binary IF-derived segmentation mask"]]
    unpublished_intermediate_artifacts: list[Literal["IF image", "DAPI image"]]


class SourceFile(StrictModel):
    filename: str = Field(min_length=1, pattern=r"^[^/]+$")
    url: AnyHttpUrl
    bytes: int = Field(gt=0)
    md5: str = Field(pattern=r"^[a-f0-9]{32}$")


class SupplementaryTable(StrictModel):
    title: Literal["Histopathological specimen in SegPath"]
    url: AnyHttpUrl
    filename: Literal["table-s2.xlsx"]
    bytes: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    slide_identity_field: Literal["TMA number"]
    tissue_identity_field: Literal["tumour type"]


class ExpectedTask(StrictModel):
    records: int = Field(gt=0)
    slides: int = Field(gt=0)
    source_roles: dict[SourceRole, int]

    @model_validator(mode="after")
    def require_complete_roles(self) -> Self:
        if set(self.source_roles) != {"train", "val", "test"}:
            raise ValueError("SegPath source roles must contain train, val, and test")
        if sum(self.source_roles.values()) != self.records:
            raise ValueError("SegPath source-role counts must equal the task record count")
        return self


class SourceTask(StrictModel):
    task_id: str = Field(pattern=r"^[A-Za-z0-9]+_[A-Za-z0-9]+$")
    zenodo_record_id: int = Field(gt=0)
    doi: str = Field(pattern=r"^10\.5281/zenodo\.[0-9]+$")
    antibody: str = Field(min_length=1)
    paper_antigen: str = Field(min_length=1)
    paper_target: str = Field(min_length=1)
    table_s2_antibody_target: str = Field(min_length=1)
    mask_derivation: MaskDerivation
    uses_dapi_nucleus_transfer: bool
    archive: SourceFile
    metadata: SourceFile
    license_file: SourceFile
    expected: ExpectedTask

    @model_validator(mode="after")
    def require_task_identity(self) -> Self:
        if self.doi != f"10.5281/zenodo.{self.zenodo_record_id}":
            raise ValueError("SegPath DOI and Zenodo record ID differ")
        if not self.archive.filename.startswith(f"{self.task_id}."):
            raise ValueError("SegPath archive must retain its native task directory name")
        transfers_to_nuclei = self.mask_derivation == "if_positive_transferred_to_dapi_nucleus"
        if self.uses_dapi_nucleus_transfer != transfers_to_nuclei:
            raise ValueError("SegPath DAPI use must match the native mask derivation")
        return self


class ExpectedDataset(StrictModel):
    record_count: int = Field(gt=0)
    artifact_count: int = Field(gt=0)
    archive_bytes: int = Field(gt=0)
    metadata_bytes: int = Field(gt=0)


class SourceManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["segpath-2022-registered-if-masks"]
    title: str = Field(min_length=1)
    publisher: str = Field(min_length=1)
    official_site: AnyHttpUrl
    paper: Paper
    license: License
    image: ImageContract
    annotation_provenance: AnnotationProvenance
    supplementary_table_s2: SupplementaryTable
    expected: ExpectedDataset
    tasks: list[SourceTask] = Field(min_length=1)

    @model_validator(mode="after")
    def require_complete_dataset(self) -> Self:
        task_ids = [task.task_id for task in self.tasks]
        if len(task_ids) != len(set(task_ids)):
            raise ValueError("SegPath task IDs must be unique")
        if len(self.tasks) != 8:
            raise ValueError("SegPath must preserve its eight antigen-specific tasks")
        if sum(task.expected.records for task in self.tasks) != self.expected.record_count:
            raise ValueError("SegPath task records differ from the dataset total")
        if self.expected.artifact_count != self.expected.record_count * 2:
            raise ValueError("each SegPath record must reference one H&E image and one mask")
        if sum(task.archive.bytes for task in self.tasks) != self.expected.archive_bytes:
            raise ValueError("SegPath archive bytes differ from the dataset total")
        if sum(task.metadata.bytes for task in self.tasks) != self.expected.metadata_bytes:
            raise ValueError("SegPath metadata bytes differ from the dataset total")
        return self


class ArtifactReference(StrictModel):
    artifact_ref: str = Field(pattern=r"^segpath://")
    archive_filename: str = Field(min_length=1)
    member_path: str = Field(min_length=1)
    role: Literal["he_input", "if_derived_binary_mask"]


class AnnotationReference(StrictModel):
    artifact: ArtifactReference
    background_value: Literal[0] = 0
    target_value: Literal[1] = 1
    provenance_task_id: str = Field(min_length=1)
    registered_to_artifact_ref: str = Field(pattern=r"^segpath://")


class NativeRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: Literal["segpath-2022-registered-if-masks"]
    record_id: str = Field(min_length=1)
    source_task_id: str = Field(min_length=1)
    antibody: str = Field(min_length=1)
    paper_target: str = Field(min_length=1)
    source_slide_id: str = Field(pattern=r"^[0-9]+$")
    source_slide_key: str = Field(min_length=1)
    published_tumour_type: str = Field(min_length=1)
    wsi_x: int = Field(ge=0)
    wsi_y: int = Field(ge=0)
    width_pixels: Literal[984]
    height_pixels: Literal[984]
    micrometers_per_pixel: float = Field(ge=0.220818, le=0.220818)
    source_role: SourceRole
    he_input: ArtifactReference
    annotation: AnnotationReference
