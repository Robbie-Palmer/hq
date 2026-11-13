from __future__ import annotations

from typing import Any, Literal, Self

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class KaggleSource(StrictModel):
    dataset_ref: Literal["ipateam/segmentation-of-nuclei-in-cryosectioned-he-images"]
    version: Literal[7]
    updated_at: Literal["2021-02-01T15:58:08.423Z"]
    landing_page_url: AnyHttpUrl
    metadata_api_url: AnyHttpUrl
    reported_total_bytes: Literal[416431626]
    license_label: Literal["MIT"]


class Archive(StrictModel):
    download_url: AnyHttpUrl
    compressed_bytes: Literal[172522035]
    md5: Literal["46ead62d5ef90d4b6277b9a4dac055be"]
    sha256: Literal["8843b3524920e0e786c66c1aa73484ed1c1ee01a5c33c20045d2b1b250c547d8"]
    checksum_provenance: Literal["computed from the Kaggle v7 download bundle"]
    publisher_checksum_manifest: Literal[False]
    retrieved_at: str


class GitHubSource(StrictModel):
    repository_url: AnyHttpUrl
    commit: Literal["06ac4090243de66e7cb81b011e041e7ecf79a68b"]
    commit_api_url: AnyHttpUrl
    selected_wsis_path: Literal["Selected_WSIs.xlsx"]
    selected_wsis_url: AnyHttpUrl
    selected_wsis_sha256: Literal[
        "d8af343ecd41133e42ea211be823901db8d25f8ce951023c1e163e934314a45b"
    ]
    license_label: Literal["MIT"]


class Publication(StrictModel):
    doi: Literal["10.1016/j.compbiomed.2021.104349"]
    url: AnyHttpUrl
    citation: str


class AnnotationRelease(StrictModel):
    release_id: Literal[
        "annotator-1-biologist-round-1",
        "annotator-1-biologist-round-2",
        "annotator-2-bioinformatician",
    ]
    annotator_role: Literal["biologist", "bioinformatician"]
    round: int = Field(ge=1, le=2)
    archive_root: str = Field(min_length=1)
    roi_count: int = Field(gt=0)


class ArtifactFamily(StrictModel):
    artifact_id: str = Field(min_length=1)
    native_path_template: str = Field(min_length=1)
    role: Literal[
        "nucleus_boundary",
        "instance_mask",
        "binary_mask",
        "boundary_removed_mask",
        "eroded_boundary_removed_mask",
        "distance_map",
        "weight_map",
        "eroded_weight_map",
        "overlay",
    ]
    extension: Literal[".roi", ".png", ".tif"]


class AnnotationInventory(StrictModel):
    releases: list[AnnotationRelease]
    artifact_families: list[ArtifactFamily]
    consensus_available: Literal[False]
    default_release: None
    paper_evaluation_release_id: Literal["annotator-1-biologist-round-1"]
    total_roi_files: Literal[23891]
    derived_png_files: Literal[540]
    derived_tif_files: Literal[270]

    @model_validator(mode="after")
    def require_native_releases(self) -> Self:
        counts = {release.release_id: release.roi_count for release in self.releases}
        if counts != {
            "annotator-1-biologist-round-1": 7596,
            "annotator-1-biologist-round-2": 8044,
            "annotator-2-bioinformatician": 8251,
        }:
            raise ValueError("annotation releases differ from CryoNuSeg v7")
        if sum(counts.values()) != self.total_roi_files:
            raise ValueError("ROI inventory differs from release totals")
        if len({family.artifact_id for family in self.artifact_families}) != 10:
            raise ValueError("CryoNuSeg must retain all ten annotation artifact families")
        return self


class ArchiveInventory(StrictModel):
    total_files: Literal[24731]
    tissue_image_files: Literal[30]
    roi_files: Literal[23891]
    derived_png_files: Literal[540]
    derived_tif_files: Literal[270]


class SourceContract(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["cryonuseg-kaggle-v7"]
    title: str = Field(min_length=1)
    kaggle: KaggleSource
    archive: Archive
    github: GitHubSource
    publication: Publication
    publishers: list[dict[str, str]] = Field(min_length=4)
    preparation: dict[str, Any]
    patch_extraction: dict[str, Any]
    annotations: AnnotationInventory
    archive_inventory: ArchiveInventory
    rights: dict[str, str]
    missingness: dict[str, Any]
    scope: dict[str, Any]
    selected_wsis_source_columns: dict[str, str]


class SelectedWSI(StrictModel):
    patch_id: str = Field(pattern=r"^Human_[A-Za-z]+_\d{2}$")
    publisher_file_url: AnyHttpUrl
    publisher_file_id: str = Field(pattern=r"^[0-9a-f-]{36}$")
    tcga_patient_barcode: str = Field(pattern=r"^TCGA-[A-Z0-9]{2}-[A-Z0-9]{4}$")
    tissue_source_site: str = Field(pattern=r"^[A-Z0-9]{2}$")
    race: str
    gender: str
    age_source_value: int
    organ_source_value: str
    bit_depth: int = Field(gt=0)
    magnification: int = Field(gt=0)
    svs_width: int | None = Field(default=None, gt=0)
    svs_height: int | None = Field(default=None, gt=0)
    pixel_dimensions: float | None = Field(default=None, gt=0)
    source_disease: str
    image_file_name: str
    centroid_x: float = Field(ge=0)
    centroid_y: float = Field(ge=0)
    annotator_2_bioinformatician_count: int = Field(ge=0)
    annotator_1_biologist_round_1_count: int = Field(ge=0)
    annotator_1_biologist_round_2_count: int = Field(ge=0)
    organwise_annotator_2_bioinformatician_count: int | None = Field(default=None, ge=0)
    organwise_annotator_1_biologist_round_1_count: int | None = Field(default=None, ge=0)
    organwise_annotator_1_biologist_round_2_count: int | None = Field(default=None, ge=0)
    artifact_note: str


class GdcSlide(StrictModel):
    tcga_patient_barcode: str
    file_id: str = Field(pattern=r"^[0-9a-f-]{36}$")
    file_name: str
    md5sum: str = Field(pattern=r"^[0-9a-f]{32}$")
    file_size: int = Field(gt=0)
    state: Literal["released"]
    access: Literal["open"]
    data_category: Literal["Biospecimen"]
    data_type: Literal["Slide Image"]
    data_format: Literal["SVS"]
    experimental_strategy: Literal["Tissue Slide"]
    submitter_id: str
    case_id: str
    project_id: str
    sample_submitter_id: str
    sample_type: str
    tissue_type: str
    portion_submitter_id: str
    slide_submitter_id: str
