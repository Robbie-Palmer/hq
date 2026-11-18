from __future__ import annotations

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

SHA256_PATTERN = r"^[a-f0-9]{64}$"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PublicBaselineConfig(StrictModel):
    schema_version: Literal["1.0.0"]
    random_seed: int = Field(ge=0)
    localization_tolerance_pixels: float = Field(gt=0)
    minimum_nucleus_pixels: int = Field(gt=0)
    watershed_minimum_distance_pixels: int = Field(gt=0)
    classification_minimum_gain: float = Field(gt=0)
    per_run_wall_seconds: int = Field(gt=0, le=86400)
    aggregate_accelerator_seconds: int = Field(gt=0, le=86400)
    accelerator: Literal["none"]


class PackagePin(StrictModel):
    name: Literal["ultralytics"]
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    license: Literal["AGPL-3.0-or-later"]
    source_commit: str = Field(pattern=r"^[a-f0-9]{40}$")


class ModelPin(StrictModel):
    task: Literal["detect", "segment"]
    architecture: str
    definition: str
    definition_url: HttpUrl
    definition_sha256: str = Field(pattern=SHA256_PATTERN)
    weights: str = Field(pattern=r"^[a-z0-9-]+\.pt$")
    weights_url: HttpUrl
    weights_bytes: int = Field(gt=0)
    weights_sha256: str = Field(pattern=SHA256_PATTERN)
    weights_license: Literal["AGPL-3.0-or-later"]


class AugmentationConfig(StrictModel):
    hsv_h: float = Field(ge=0)
    hsv_s: float = Field(ge=0)
    hsv_v: float = Field(ge=0)
    degrees: float = Field(ge=0)
    translate: float = Field(ge=0)
    scale: float = Field(ge=0)
    shear: float = Field(ge=0)
    perspective: float = Field(ge=0)
    flip_up_down: float = Field(ge=0, le=1)
    flip_left_right: float = Field(ge=0, le=1)
    bgr: float = Field(ge=0, le=1)
    mosaic: float = Field(ge=0, le=1)
    mixup: float = Field(ge=0, le=1)
    cutmix: float = Field(ge=0, le=1)
    copy_paste: float = Field(ge=0, le=1)


class TrainingConfig(StrictModel):
    device: Literal[0]
    image_size: int = Field(gt=0)
    epochs: int = Field(gt=0)
    patience: int = Field(ge=0)
    batch: int = Field(gt=0)
    workers: int = Field(ge=0)
    optimizer: Literal["AdamW"]
    initial_learning_rate: float = Field(gt=0)
    final_learning_rate_fraction: float = Field(gt=0)
    momentum: float = Field(ge=0, lt=1)
    weight_decay: float = Field(ge=0)
    warmup_epochs: float = Field(ge=0)
    cosine_learning_rate: Literal[False]
    amp: bool
    deterministic: bool
    cache: Literal[False]
    rectangular_batches: Literal[False]
    multi_scale: Literal[False]
    close_mosaic_epochs: int = Field(ge=0)
    segment_initialization: Literal["source_weights", "detect_checkpoint_backbone_neck"]
    augmentation: AugmentationConfig


class InferenceConfig(StrictModel):
    confidence_threshold: float = Field(ge=0, le=1)
    iou_threshold: float = Field(ge=0, le=1)
    class_agnostic_nms: bool
    nms: bool
    maximum_detections: int = Field(gt=0)
    half_precision: bool
    retina_masks: bool


class ResourceLimits(StrictModel):
    per_task_wall_seconds: int = Field(gt=0, le=86400)
    aggregate_gpu_seconds: int = Field(gt=0, le=86400)
    maximum_peak_vram_bytes: int = Field(gt=0)


class ExportDecision(StrictModel):
    performed: Literal[False]
    reason: str = Field(min_length=1)


class LearnedBaselineConfig(StrictModel):
    schema_version: Literal["1.0.0"]
    localization_tolerance_pixels: float = Field(gt=0)
    maximum_border_clip_pixels: float = Field(ge=0, le=2)
    package: PackagePin
    models: dict[Literal["detect", "segment"], ModelPin]
    training: TrainingConfig
    inference: InferenceConfig
    seeds: dict[Literal["detect", "segment"], int]
    limits: ResourceLimits
    prior_failed_gpu_seconds_upper_bound: float = Field(ge=0)
    stop_rules: list[str] = Field(min_length=1)
    export: ExportDecision

    @model_validator(mode="after")
    def require_complete_predeclaration(self) -> Self:
        if set(self.models) != {"detect", "segment"}:
            raise ValueError("detect and segment model pins are required")
        if any(key != model.task for key, model in self.models.items()):
            raise ValueError("model task keys must match their pinned task")
        if set(self.seeds) != {"detect", "segment"}:
            raise ValueError("detect and segment seeds are required")
        if len(set(self.seeds.values())) != 2:
            raise ValueError("task seeds must differ")
        return self


class ResourceEvidence(StrictModel):
    wall_seconds: float = Field(ge=0)
    cpu_seconds: float = Field(ge=0)
    gpu_seconds: Literal[0]
    peak_rss_bytes: int = Field(ge=0)
    peak_vram_bytes: Literal[0]
    accelerator: Literal["none"]
    per_run_wall_ceiling_seconds: int
    aggregate_gpu_ceiling_seconds: int


class AcceleratorResourceEvidence(StrictModel):
    wall_seconds: float = Field(ge=0)
    cpu_seconds: float = Field(ge=0)
    gpu_seconds: float = Field(ge=0)
    peak_rss_bytes: int = Field(ge=0)
    peak_vram_bytes: int = Field(ge=0)
    accelerator: Literal["cuda:0"]
    measurement: Literal[
        "CUDA event elapsed time and PyTorch peak allocated memory",
        "Ultralytics cumulative elapsed time as a conservative interrupted-run GPU upper "
        "bound, plus CUDA event continuation time; PyTorch peak allocated memory",
    ]
    wall_ceiling_seconds: int = Field(gt=0)
    aggregate_gpu_ceiling_seconds: int = Field(gt=0)


class SpatialPrediction(StrictModel):
    instance_id: int = Field(gt=0)
    class_name: str
    confidence: float = Field(ge=0, le=1)
    bbox_xyxy_pixels: tuple[float, float, float, float]
    polygon_xy_pixels: list[tuple[float, float]] | None


class SpatialPredictionRecord(StrictModel):
    schema_version: Literal["1.0.0"]
    task: Literal["detect", "segment"]
    item_id: str
    slide_id: str
    patient_id: str
    site_id: str
    split: Literal["test"]
    image_width: int = Field(gt=0)
    image_height: int = Field(gt=0)
    predictions: list[SpatialPrediction]


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
