from __future__ import annotations

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class License(StrictModel):
    spdx_id: Literal["CC0-1.0"]
    url: HttpUrl
    evidence_url: HttpUrl


class SourceArchive(StrictModel):
    name: Literal["rgb", "annotations", "splits"]
    url: HttpUrl
    bytes: int = Field(gt=0)
    md5: str = Field(pattern=r"^[a-f0-9]{32}$")
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    member_prefix: str = Field(min_length=1)
    member_suffix: Literal[".png", ".csv"]


class DatasetManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["nucls-corrected-single-rater-20220301"]
    title: str
    doi: Literal["10.5524/102207"]
    paper_doi: Literal["10.1093/gigascience/giac037"]
    license: License
    publisher: str
    publisher_record: HttpUrl
    archives: list[SourceArchive]
    classification_field: Literal["super_classification"]
    classification_labels: list[str] = Field(min_length=2)
    unmappable_categories: dict[str, str]

    @model_validator(mode="after")
    def require_complete_source(self) -> Self:
        if {archive.name for archive in self.archives} != {"rgb", "annotations", "splits"}:
            raise ValueError("NuCLS source must pin RGB, annotation, and split archives")
        if len(self.classification_labels) != len(set(self.classification_labels)):
            raise ValueError("classification labels must be unique")
        if set(self.classification_labels).intersection(self.unmappable_categories):
            raise ValueError("unmappable categories cannot also be classification labels")
        return self


class Experiment(StrictModel):
    schema_version: Literal["1.0.0"]
    experiment_id: Literal["nucls-public-baseline-v1"]
    dataset_manifest: str
    data_directory: str
    output_directory: str
    random_seed: int = Field(ge=0)
    test_fold: int = Field(ge=1, le=5)
    validation_fold: int = Field(ge=1, le=5)
    localization_tolerance_pixels: float = Field(gt=0)
    minimum_nucleus_pixels: int = Field(gt=0)
    watershed_minimum_distance_pixels: int = Field(gt=0)
    classification_minimum_gain: float = Field(gt=0)
    per_run_wall_seconds: int = Field(gt=0, le=86400)
    aggregate_accelerator_seconds: int = Field(gt=0, le=86400)
    accelerator: Literal["none"]

    @model_validator(mode="after")
    def require_distinct_folds(self) -> Self:
        if self.test_fold == self.validation_fold:
            raise ValueError("validation and test folds must differ")
        return self


class ArchiveEvidence(StrictModel):
    name: str
    url: str
    bytes: int
    md5: str
    sha256: str
    extracted_files: int = Field(gt=0)


class AcquisitionEvidence(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: str
    archives: list[ArchiveEvidence]


class SplitItem(StrictModel):
    item_id: str
    slide_id: str
    patient_id: str
    site_id: str
    split: Literal["train", "validation", "test"]
    image_path: str
    annotation_path: str


class CohortEvidence(StrictModel):
    schema_version: Literal["1.0.0"]
    leakage_unit: Literal["patient_id"]
    secondary_leakage_unit: Literal["slide_id"]
    source_statement: str
    items: list[SplitItem]
    item_counts: dict[str, int]
    patient_counts: dict[str, int]
    slide_counts: dict[str, int]
    site_counts: dict[str, int]
    patient_intersections: dict[str, list[str]]
    slide_intersections: dict[str, list[str]]
    site_intersections: dict[str, list[str]]
    held_out_test_sites: list[str]


class ResourceEvidence(StrictModel):
    wall_seconds: float = Field(ge=0)
    cpu_seconds: float = Field(ge=0)
    gpu_seconds: Literal[0]
    peak_rss_bytes: int = Field(ge=0)
    peak_vram_bytes: Literal[0]
    accelerator: Literal["none"]
    per_run_wall_ceiling_seconds: int
    aggregate_gpu_ceiling_seconds: int


class LocalizationMetrics(StrictModel):
    match_tolerance_pixels: float = Field(gt=0)
    precision: float = Field(ge=0, le=1)
    recall: float = Field(ge=0, le=1)
    f1: float = Field(ge=0, le=1)
    truth_points: int = Field(ge=0)
    predicted_points: int = Field(ge=0)
    matched_points: int = Field(ge=0)
    truth_by_annotation_type: dict[str, int]


class InstanceSegmentationMetrics(StrictModel):
    eligible_polygon_instances: int = Field(ge=0)
    localized_polygon_instances: int = Field(ge=0)
    localization_coverage: float = Field(ge=0, le=1)
    mean_instance_iou: float = Field(ge=0, le=1)
    mean_instance_dice: float = Field(ge=0, le=1)
    success_at_iou_0_5: float = Field(ge=0, le=1)


class ClassificationMetrics(StrictModel):
    evaluated_instances: int = Field(ge=0)
    macro_f1: float = Field(ge=0, le=1)
    brier: float = Field(ge=0)
    ece_10_bin: float = Field(ge=0, le=1)
    negative_log_likelihood: float = Field(ge=0)


class MorphologyEvidence(StrictModel):
    localization: LocalizationMetrics
    instance_segmentation: InstanceSegmentationMetrics


class TaskEvidence(MorphologyEvidence):
    classification: ClassificationMetrics


class RunEvidence(TaskEvidence):
    adapter_id: Literal["class-prior-v1", "morphology-logistic-v1"]
    per_class: dict[str, dict[str, float | int]]
    site_slices: dict[str, TaskEvidence]
    exclusions: dict[str, int]
    failures: list[dict[str, str]]
    resources: ResourceEvidence


class ClassificationRunEvidence(StrictModel):
    adapter_id: Literal["class-prior-v1", "morphology-logistic-v1"]
    classification: ClassificationMetrics
    per_class: dict[str, dict[str, float | int]]
    site_slices: dict[str, ClassificationMetrics]
    exclusions: dict[str, int]
    failures: list[dict[str, str]]
    resources: ResourceEvidence


class GateEvidence(StrictModel):
    gate: str
    passed: bool
    observed: float | None
    threshold: float
    detail: str


class ExperimentEvidence(StrictModel):
    schema_version: Literal["1.1.0"]
    experiment_id: str
    dataset: dict[str, object]
    ontology: dict[str, object]
    split: dict[str, object]
    methods: dict[str, object]
    localization: LocalizationMetrics
    instance_segmentation: InstanceSegmentationMetrics
    morphology_site_slices: dict[str, MorphologyEvidence]
    baseline: ClassificationRunEvidence
    candidate: ClassificationRunEvidence
    gates: list[GateEvidence]
    recommendation: Literal["promote_candidate", "reject_candidate"]
    stop_reason: str
    clinical_validity: Literal[False]
