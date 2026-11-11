from __future__ import annotations

from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

MappingStatus = Literal["exact", "partial", "source_merged", "unmapped", "dropped"]
TargetRole = Literal["lesion_inclusion", "viable_lesion_inclusion", "analysis_exclusion"]
ProductRole = Literal["train", "validation", "test"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


class Point(StrictModel):
    x: float = Field(ge=0)
    y: float = Field(ge=0)


class Polygon(StrictModel):
    geometry_type: Literal["polygon"]
    rings: list[list[Point]] = Field(min_length=1)

    @model_validator(mode="after")
    def require_polygon_rings(self) -> Self:
        if any(len(ring) < 3 for ring in self.rings):
            raise ValueError("every polygon ring must contain at least three vertices")
        return self


class CoordinateFrame(StrictModel):
    coordinate_system: Literal["slide"]
    origin: Literal["level_0_top_left"]
    axis_order: Literal["xy"]
    unit: Literal["pixel"]
    pyramid_level: int = Field(ge=0)
    level_downsample: float = Field(ge=1)
    micrometres_per_pixel_x: float | None = Field(default=None, gt=0)
    micrometres_per_pixel_y: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def require_complete_scale(self) -> Self:
        if (self.micrometres_per_pixel_x is None) != (self.micrometres_per_pixel_y is None):
            raise ValueError("physical scale must include both micrometres-per-pixel axes")
        if self.pyramid_level == 0 and self.level_downsample != 1:
            raise ValueError("level-0 coordinates must have a downsample of 1")
        return self


class StainProvenance(StrictModel):
    method: Literal["H&E", "IHC", "other"]
    source_name: str = Field(min_length=1)
    ihc_marker: str | None = None

    @model_validator(mode="after")
    def require_ihc_marker(self) -> Self:
        if self.method == "IHC" and not self.ihc_marker:
            raise ValueError("IHC provenance must name its marker")
        if self.method != "IHC" and self.ihc_marker is not None:
            raise ValueError("only IHC provenance may carry an IHC marker")
        return self


class MolecularStatusLink(StrictModel):
    subject_id: str = Field(min_length=1)
    biomarker: str = Field(min_length=1)
    value: str = Field(min_length=1)
    assay: str = Field(min_length=1)
    evidence_reference: str = Field(min_length=1)


class NativeROIRecord(StrictModel):
    schema_version: Literal["1.0.0"]
    source_dataset_id: str = Field(min_length=1)
    source_record_id: str = Field(min_length=1)
    slide_id: str = Field(min_length=1)
    source_group_id: str = Field(min_length=1)
    source_role: str = Field(min_length=1)
    organ: str = Field(min_length=1)
    image_reference: str = Field(min_length=1)
    annotation_reference: str = Field(min_length=1)
    image_artifact_id: str | None = None
    annotation_artifact_id: str | None = None
    image_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    annotation_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    stain: StainProvenance
    coordinate_frame: CoordinateFrame
    region_id: str = Field(min_length=1)
    source_region_label: str = Field(min_length=1)
    geometry: Polygon
    molecular_status_links: list[MolecularStatusLink]
    source_attributes: dict[str, Any]


class LabelMapping(StrictModel):
    source_label: str = Field(min_length=1)
    target_role: TargetRole | None
    status: MappingStatus

    @model_validator(mode="after")
    def require_consistent_target(self) -> Self:
        if self.status in {"unmapped", "dropped"} and self.target_role is not None:
            raise ValueError("unmapped and dropped mappings cannot assign a target role")
        if self.status not in {"unmapped", "dropped"} and self.target_role is None:
            raise ValueError("retained mappings must assign a target role")
        return self


class Adapter(StrictModel):
    schema_version: Literal["1.0.0"]
    adapter_id: str = Field(min_length=1)
    source_dataset_id: str = Field(min_length=1)
    target_ontology_id: str = Field(min_length=1)
    mappings: list[LabelMapping] = Field(min_length=1)
    notes: list[str]

    @model_validator(mode="after")
    def require_unique_source_labels(self) -> Self:
        labels = [mapping.source_label for mapping in self.mappings]
        if len(labels) != len(set(labels)):
            raise ValueError("adapter source labels must be unique")
        return self


class SplitPolicy(StrictModel):
    method: Literal["sha256_threshold"]
    group_key: Literal["source_dataset_id:source_group_id"]
    seed: str = Field(min_length=1)
    validation_fraction: float = Field(gt=0, lt=1)
    official_test_roles: list[str] = Field(min_length=1)


class ProductSpec(StrictModel):
    schema_version: Literal["1.0.0"]
    product_id: str = Field(min_length=1)
    description: str = Field(min_length=1)
    contract_id: Literal["pathologize-roi-segmentation-v1"]
    ontology_id: Literal["pathologize-roi-selection-v1"]
    split_policy: SplitPolicy
    leakage_units: list[Literal["source_group_id", "slide_id"]]
    coordinate_policy: Literal["preserve_source_frame"]
    stain_policy: Literal["preserve_source_provenance"]
    molecular_status_policy: Literal["preserve_linked_status_without_inference"]

    @model_validator(mode="after")
    def require_leakage_units(self) -> Self:
        if self.leakage_units != ["source_group_id", "slide_id"]:
            raise ValueError("ROI product must fence source groups and slides")
        return self


class SourceImport(StrictModel):
    dataset_id: str = Field(min_length=1)
    source_ticket: str | None
    planned_project: str = Field(min_length=1)
    interface: str = Field(min_length=1)
    lock: str = Field(min_length=1)
    binding_kind: Literal["contract_fixture", "source_interface"]
    binding_path: str = Field(min_length=1)


class ImportManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    imports: list[SourceImport] = Field(min_length=2)

    @model_validator(mode="after")
    def require_unique_datasets(self) -> Self:
        datasets = [item.dataset_id for item in self.imports]
        if len(datasets) != len(set(datasets)):
            raise ValueError("source imports must have unique dataset IDs")
        return self


class SourceArtifactReference(StrictModel):
    source_product_id: str
    artifact_id: str
    uri: str
    sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")


class ROIRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    product_id: str
    contract_id: Literal["pathologize-roi-segmentation-v1"]
    semantic_scope: Literal["roi_selection"] = "roi_selection"
    record_id: str
    source_dataset_id: str
    source_record_id: str
    slide_id: str
    source_group_id: str
    source_role: str
    product_role: ProductRole
    role_mapping_status: Literal["preserved_official_test", "repartitioned_development"]
    organ: str
    image_artifact: SourceArtifactReference
    annotation_artifact: SourceArtifactReference
    stain: StainProvenance
    coordinate_frame: CoordinateFrame
    region_id: str
    source_region_label: str
    target_roi_role: TargetRole
    mapping_status: MappingStatus
    geometry: Polygon
    molecular_status_links: list[MolecularStatusLink]
    source_attributes: dict[str, Any]
    adapter_id: str
