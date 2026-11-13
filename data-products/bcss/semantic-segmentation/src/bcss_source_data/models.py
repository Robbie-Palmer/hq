from __future__ import annotations

import math
from typing import Literal, Self

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


def _matches_published_float(value: float, expected: float) -> bool:
    return math.isclose(value, expected, rel_tol=0.0, abs_tol=1e-12)


class Digest(StrictModel):
    md5: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def require_digest(self) -> Self:
        if self.md5 is None and self.sha256 is None:
            raise ValueError("at least one artifact digest is required")
        return self


class SourceFile(StrictModel):
    name: str = Field(min_length=1)
    url: AnyHttpUrl
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class Rights(StrictModel):
    dataset_spdx_id: Literal["CC0-1.0"]
    dataset_evidence_url: AnyHttpUrl
    figshare_license_url: AnyHttpUrl
    code_spdx_id: Literal["MIT"]
    code_license_url: AnyHttpUrl
    tcga_policy_url: AnyHttpUrl
    redistribution_note: str = Field(min_length=1)


class PublishedRoleEvidence(StrictModel):
    role: Literal["core_train", "core_test", "evaluation"]
    record_count: int = Field(gt=0)
    evidence_url: AnyHttpUrl
    assignments: Literal["not_published_with_source_metadata"]


class PhysicalScale(StrictModel):
    published_microns_per_pixel: float = Field(gt=0)
    roi_coordinate_space: Literal["wsi_base_pixels"]
    annotation_coordinate_space: Literal["wsi_base_pixels"]
    scan_magnifications: list[float]

    @model_validator(mode="after")
    def require_published_scale(self) -> Self:
        if not _matches_published_float(self.published_microns_per_pixel, 0.25):
            raise ValueError("BCSS publication scale must remain 0.25 microns per pixel")
        expected_magnifications = [20.0, 40.0]
        if len(self.scan_magnifications) != len(expected_magnifications) or not all(
            _matches_published_float(actual, expected)
            for actual, expected in zip(
                self.scan_magnifications, expected_magnifications, strict=True
            )
        ):
            raise ValueError("BCSS scan magnifications must remain 20x and 40x")
        return self


class SourceImageSemantics(StrictModel):
    stain: Literal["hematoxylin_and_eosin"]
    source_project: Literal["TCGA-BRCA"]
    roi_media_type: Literal["image/png"]
    mask_media_type: Literal["image/png"]
    annotation_media_type: Literal["application/json"]
    evidence_url: AnyHttpUrl


class SourceContract(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["bcss-figshare-7193138-v2"]
    title: str = Field(min_length=1)
    repository_url: AnyHttpUrl
    repository_revision: str = Field(pattern=r"^[a-f0-9]{40}$")
    paper_doi: Literal["10.1093/bioinformatics/btz083"]
    paper_url: AnyHttpUrl
    figshare_article_id: Literal[7193138]
    figshare_doi: Literal["10.6084/m9.figshare.7193138.v2"]
    figshare_api_url: AnyHttpUrl
    source_files: list[SourceFile]
    rights: Rights
    source_image_semantics: SourceImageSemantics
    physical_scale: PhysicalScale
    published_role_evidence: list[PublishedRoleEvidence]
    record_count: Literal[151]
    mask_count: Literal[151]
    annotation_artifact_count: Literal[151]

    @model_validator(mode="after")
    def require_complete_contract(self) -> Self:
        required = {
            "README.md",
            "LICENSE",
            "configs.py",
            "download_crowdsource_dataset.py",
            "meta/gtruth_codes.tsv",
            "meta/roiBounds.csv",
            "meta/slide_magnifications.csv",
        }
        if {item.name for item in self.source_files} != required:
            raise ValueError("source contract must pin every BCSS metadata and retrieval file")
        if {item.role for item in self.published_role_evidence} != {
            "core_train",
            "core_test",
            "evaluation",
        }:
            raise ValueError("source contract must retain every published experimental role")
        return self


class NativeCode(StrictModel):
    code: int = Field(ge=0, le=255)
    label: str = Field(min_length=1)
    source_use: Literal["class", "ignore"]
    source_note: str | None = None


class Ontology(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["bcss-figshare-7193138-v2"]
    evidence_url: AnyHttpUrl
    codes: list[NativeCode]


class RoiBounds(StrictModel):
    xmin: int = Field(ge=0)
    ymin: int = Field(ge=0)
    xmax: int = Field(gt=0)
    ymax: int = Field(gt=0)
    coordinate_space: Literal["wsi_base_pixels"]

    @model_validator(mode="after")
    def require_positive_extent(self) -> Self:
        if self.xmax <= self.xmin or self.ymax <= self.ymin:
            raise ValueError("ROI bounds must have a positive extent")
        return self


class GdcArtifact(StrictModel):
    file_id: str = Field(pattern=r"^[a-f0-9-]{36}$")
    file_name: str = Field(min_length=1)
    download_url: AnyHttpUrl
    bytes: int = Field(gt=0)
    md5: str = Field(pattern=r"^[a-f0-9]{32}$")
    access: Literal["open"]
    case_id: str = Field(pattern=r"^[a-f0-9-]{36}$")
    project_id: Literal["TCGA-BRCA"]


class WsiReference(StrictModel):
    publisher_file_name: str = Field(min_length=1)
    dsa_item_id: str = Field(pattern=r"^[a-f0-9]{24}$")
    scan_magnification: float
    gdc_resolution: Literal["resolved", "not_found_at_snapshot"]
    gdc: GdcArtifact | None

    @model_validator(mode="after")
    def match_resolution(self) -> Self:
        if not any(
            _matches_published_float(self.scan_magnification, expected) for expected in (20.0, 40.0)
        ):
            raise ValueError("BCSS scan magnification must be 20x or 40x")
        if (self.gdc_resolution == "resolved") != (self.gdc is not None):
            raise ValueError("GDC resolution and artifact must agree")
        return self


class MaskArtifact(StrictModel):
    file_id: int = Field(gt=0)
    name: str = Field(min_length=1)
    url: AnyHttpUrl
    bytes: int = Field(gt=0)
    digests: Digest
    media_type: Literal["image/png"]


class AnnotationArtifact(StrictModel):
    name: str = Field(pattern=r"^[a-f0-9]{24}\.json$")
    url: AnyHttpUrl
    bytes: int = Field(gt=0)
    digests: Digest
    media_type: Literal["application/json"]
    coordinate_space: Literal["wsi_base_pixels"]


class ImageExtraction(StrictModel):
    microns_per_pixel: float = Field(gt=0)
    source: Literal["publisher_wsi_region_recipe"]

    @model_validator(mode="after")
    def require_published_scale(self) -> Self:
        if not _matches_published_float(self.microns_per_pixel, 0.25):
            raise ValueError("BCSS image extraction must retain the publisher 0.25 MPP")
        return self


class NativeRecord(StrictModel):
    record_id: str = Field(min_length=1)
    roi_id: str = Field(min_length=1)
    patient_id: str = Field(pattern=r"^TCGA-[A-Z0-9]{2}-[A-Z0-9]{4}$")
    slide_barcode: str = Field(min_length=1)
    publisher_roles: list[Literal["core_train", "core_test", "evaluation"]]
    wsi: WsiReference
    roi: RoiBounds
    image_extraction: ImageExtraction
    mask: MaskArtifact
    annotations: AnnotationArtifact


class Provenance(StrictModel):
    repository_revision: str = Field(pattern=r"^[a-f0-9]{40}$")
    figshare_doi: Literal["10.6084/m9.figshare.7193138.v2"]
    gdc_api_url: AnyHttpUrl
    gdc_snapshot_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    dsa_api_url: AnyHttpUrl
    dsa_snapshot_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    unresolved_gdc_wsi_names: list[str]


class NativeCorpus(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["bcss-figshare-7193138-v2"]
    provenance: Provenance
    records: list[NativeRecord]
