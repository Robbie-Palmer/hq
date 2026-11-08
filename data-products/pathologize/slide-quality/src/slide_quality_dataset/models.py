from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class LabelMapping(StrictModel):
    source_label: str = Field(min_length=1)
    target_labels: list[str] = Field(min_length=1)
    status: Literal["exact", "source_merged", "partial", "unmapped", "dropped"]


class Adapter(StrictModel):
    schema_version: Literal["1.0.0"]
    adapter_id: str = Field(min_length=1)
    source_dataset_id: str = Field(min_length=1)
    target_ontology_id: str = Field(min_length=1)
    mappings: list[LabelMapping] = Field(min_length=1)
    notes: list[str]

    @model_validator(mode="after")
    def source_labels_are_unique(self) -> Adapter:
        labels = [mapping.source_label for mapping in self.mappings]
        if len(labels) != len(set(labels)):
            raise ValueError("adapter source labels must be unique")
        return self


class SplitPolicy(StrictModel):
    method: Literal["sha256_threshold"]
    group_key: Literal["source_group_id"]
    seed: str = Field(min_length=1)
    train_fraction: float = Field(gt=0, lt=1)
    validation_fraction: float = Field(gt=0, lt=1)
    test_fraction: float = Field(gt=0, lt=1)

    @model_validator(mode="after")
    def fractions_sum_to_one(self) -> SplitPolicy:
        if abs(self.train_fraction + self.validation_fraction + self.test_fraction - 1) > 1e-9:
            raise ValueError("split fractions must sum to one")
        return self


class ProductSpec(StrictModel):
    schema_version: Literal["1.0.0"]
    product_id: str = Field(min_length=1)
    description: str = Field(min_length=1)
    ontology_id: str = Field(min_length=1)
    grandqc_split: SplitPolicy
    role_policy: dict[str, Literal["development_repartition", "external_test"]]


class HarmonizedRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    product_id: str
    record_id: str
    source_dataset_id: str
    source_record_id: str
    source_group_id: str
    source_role: str
    product_role: Literal["train", "validation", "internal_test", "external_test"]
    role_mapping_status: Literal["preserved", "overridden_for_development"]
    image_scope: Literal["patch", "whole_slide"]
    image_path: str
    annotation_path: str
    micrometres_per_pixel: float | None
    source_labels_present: list[str]
    target_labels_present: list[str]
    mapping_statuses: dict[str, str]
    adapter_id: str
    source_payload: dict[str, object]
