from __future__ import annotations

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class LabelMapping(StrictModel):
    source_label: str = Field(min_length=1)
    target_label: str = Field(min_length=1)
    status: Literal["exact", "source_merged", "partial", "unmapped", "dropped"]


class Adapter(StrictModel):
    schema_version: Literal["1.0.0"]
    adapter_id: str = Field(min_length=1)
    source_dataset_id: str = Field(min_length=1)
    target_ontology_id: str = Field(min_length=1)
    mappings: list[LabelMapping] = Field(min_length=1)
    notes: list[str]

    @model_validator(mode="after")
    def labels_are_unique(self) -> Self:
        labels = [mapping.source_label for mapping in self.mappings]
        if len(labels) != len(set(labels)):
            raise ValueError("adapter source labels must be unique")
        return self


class ProductSpec(StrictModel):
    schema_version: Literal["1.0.0"]
    product_id: str = Field(min_length=1)
    description: str = Field(min_length=1)
    source_dataset_id: str = Field(min_length=1)
    ontology_id: str = Field(min_length=1)
    test_fold: int = Field(ge=1, le=5)
    validation_fold: int = Field(ge=1, le=5)
    leakage_units: list[Literal["patient_id", "slide_id"]]
    empty_image_policy: Literal["preserve"]
    coordinate_policy: Literal["preserve_source_pixels"]

    @model_validator(mode="after")
    def folds_are_distinct(self) -> Self:
        if self.test_fold == self.validation_fold:
            raise ValueError("validation and test folds must differ")
        return self


class DatasetRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    product_id: str
    source_dataset_id: str
    item_id: str
    slide_id: str
    patient_id: str
    site_id: str
    split: Literal["train", "validation", "test"]
    image_path: str
    annotation_path: str
    source_roles: dict[str, Literal["train", "test"]]
    source_labels_present: list[str]
    source_ontology_labels_present: dict[str, list[str]] = Field(default_factory=dict)
    target_labels_present: list[str]
    annotation_count: int = Field(ge=0)
    adapter_id: str


SplitItem = DatasetRecord


class CohortEvidence(StrictModel):
    schema_version: Literal["1.0.0"]
    product_id: str
    leakage_unit: Literal["patient_id"]
    secondary_leakage_unit: Literal["slide_id"]
    source_statement: str
    items: list[DatasetRecord]
    item_counts: dict[str, int]
    patient_counts: dict[str, int]
    slide_counts: dict[str, int]
    site_counts: dict[str, int]
    patient_intersections: dict[str, list[str]]
    slide_intersections: dict[str, list[str]]
    site_intersections: dict[str, list[str]]
    held_out_test_sites: list[str]
