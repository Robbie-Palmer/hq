from __future__ import annotations

from typing import Literal, Self

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class License(StrictModel):
    spdx_id: Literal["CC0-1.0"]
    url: AnyHttpUrl
    evidence_url: AnyHttpUrl


class SourceArchive(StrictModel):
    name: Literal["rgb", "annotations", "splits"]
    url: AnyHttpUrl
    bytes: int = Field(gt=0)
    md5: str = Field(pattern=r"^[a-f0-9]{32}$")
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    member_prefix: str = Field(min_length=1)
    member_suffix: Literal[".png", ".csv"]


class SourceManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["nucls-corrected-single-rater-20220301"]
    title: str = Field(min_length=1)
    doi: Literal["10.5524/102207"]
    paper_doi: Literal["10.1093/gigascience/giac037"]
    license: License
    publisher: str = Field(min_length=1)
    publisher_record: AnyHttpUrl
    archives: list[SourceArchive]
    classification_fields: list[
        Literal["raw_classification", "main_classification", "super_classification"]
    ]
    classification_field: Literal["super_classification"]
    classification_labels: list[str] = Field(min_length=2)
    unmappable_categories: dict[str, str]

    @model_validator(mode="after")
    def require_complete_source(self) -> Self:
        if {archive.name for archive in self.archives} != {"rgb", "annotations", "splits"}:
            raise ValueError("NuCLS source must pin RGB, annotation, and split archives")
        labels = [*self.classification_labels, *self.unmappable_categories]
        if len(labels) != len(set(labels)):
            raise ValueError("native labels must be unique")
        if self.classification_fields != [
            "raw_classification",
            "main_classification",
            "super_classification",
        ]:
            raise ValueError("NuCLS classification fields must preserve all published tiers")
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


class NativeRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: Literal["nucls-corrected-single-rater-20220301"]
    item_id: str
    slide_id: str
    patient_id: str
    site_id: str
    image_path: str
    annotation_path: str
    source_roles: dict[str, Literal["train", "test"]]
    source_labels_present: list[str]
    source_ontology_labels_present: dict[str, list[str]] = Field(default_factory=dict)
    annotation_count: int = Field(ge=0)
