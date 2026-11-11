from __future__ import annotations

from typing import Literal, Self

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Rights(StrictModel):
    spdx_id: Literal["CC0-1.0"]
    deed_url: AnyHttpUrl
    evidence_url: AnyHttpUrl


class MetadataSource(StrictModel):
    source_id: str
    url: AnyHttpUrl
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    role: Literal["checksums", "readme", "slide_labels", "patient_and_slide_labels"]


class AnnotationArchive(StrictModel):
    artifact_id: str
    challenge: Literal["CAMELYON16", "CAMELYON17"]
    source_role: Literal["training", "testing"]
    path: str
    source_url: AnyHttpUrl
    bytes: int = Field(gt=0)
    md5: str = Field(pattern=r"^[0-9a-f]{32}$")
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class SourceContract(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["camelyon-gigadb-100439-roi-v1"]
    title: str
    doi: Literal["10.5524/100439"]
    paper_doi: Literal["10.1093/gigascience/giy065"]
    publisher: Literal["GigaScience Database"]
    publisher_record: AnyHttpUrl
    publisher_version: Literal["2018-05-21"]
    release_date: Literal["2018-05-21"]
    rights: Rights
    metadata_sources: list[MetadataSource]
    annotation_archives: list[AnnotationArchive]
    coordinate_frame: dict[str, object]
    annotation_review: dict[str, object]
    centres: dict[str, object]
    scope: dict[str, int]

    @model_validator(mode="after")
    def require_complete_contract(self) -> Self:
        if len(self.metadata_sources) != 6:
            raise ValueError("source contract must pin six official metadata records")
        if len(self.annotation_archives) != 3:
            raise ValueError("source contract must pin three XML annotation archives")
        expected_scope = {
            "camelyon16_slides": 399,
            "camelyon16_training_slides": 270,
            "camelyon16_testing_slides": 129,
            "camelyon17_annotated_training_slides": 50,
        }
        if self.scope != expected_scope:
            raise ValueError("source contract scope differs from the publisher records")
        return self


class ArtifactReference(StrictModel):
    artifact_id: str
    challenge: Literal["CAMELYON16", "CAMELYON17"]
    source_role: Literal["training", "testing"]
    path: str
    source_url: AnyHttpUrl
    bytes: int = Field(gt=0)
    md5: str = Field(pattern=r"^[0-9a-f]{32}$")
    format: Literal["pyramidal_tiff", "patient_zip"]
    contains_slide_ids: list[str] = Field(min_length=1)


class ArtifactManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["camelyon-gigadb-100439-roi-v1"]
    artifacts: list[ArtifactReference] = Field(min_length=1)


class SlideArtifactLink(StrictModel):
    artifact_id: str
    archive_member: str | None


class AnnotationLink(StrictModel):
    artifact_id: str
    archive_member: str
    native_groups: list[str] = Field(min_length=2)


class Scale(StrictModel):
    coordinate_space: Literal["whole_slide_level_0"]
    coordinate_unit: Literal["pixel"]
    axes: Literal["X,Y"]
    physical_spacing: Literal["embedded_in_pyramidal_tiff"]


class NativeRecord(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["camelyon-gigadb-100439-roi-v1"]
    record_id: str
    challenge: Literal["CAMELYON16", "CAMELYON17"]
    source_role: Literal["training", "testing"]
    patient_id: str | None
    centre_id: str | None
    node_id: str | None
    slide_id: str
    stain: Literal["H&E"]
    slide_label: str
    lesion_category: str | None
    patient_stage: str | None
    identity_completeness: Literal["complete", "not_published_for_camelyon16"]
    annotation_completeness: Literal["exhaustive", "non_exhaustive"]
    annotation_completeness_detail: dict[str, Literal["exhaustive", "non_exhaustive"]]
    slide_artifact: SlideArtifactLink
    lesion_annotation: AnnotationLink | None
    scale: Scale


class Coordinate(StrictModel):
    order: int = Field(ge=0)
    x: float
    y: float


class LesionAnnotation(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    slide_id: str
    annotation_name: str
    annotation_type: str
    group: str
    coordinates: list[Coordinate] = Field(min_length=1)
