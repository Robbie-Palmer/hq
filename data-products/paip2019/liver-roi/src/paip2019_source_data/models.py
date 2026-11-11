from __future__ import annotations

from datetime import date
from typing import Literal, Self

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, field_validator, model_validator

SHA256_PATTERN = r"^[0-9a-f]{64}$"
SOURCE_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._-]*$"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SourceReference(StrictModel):
    publisher: Literal["PAIP Committee"]
    landing_page_url: AnyHttpUrl
    dataset_page_url: AnyHttpUrl
    access_page_url: AnyHttpUrl
    paper_doi: Literal["10.1016/j.media.2020.101854"]
    retrieved_at: date


class Dua(StrictModel):
    url: AnyHttpUrl
    bytes: int = Field(gt=0)
    sha256: str = Field(pattern=SHA256_PATTERN)
    approval_authority: Literal["PAIP Committee"]
    restrictions: list[str] = Field(min_length=5)


class AccessPolicy(StrictModel):
    policy: Literal["manual_dua_approval"]
    authentication_required: Literal[True]
    automated_access: Literal[False]
    dataset_bytes_publicly_redistributable: Literal[False]
    dua: Dua


class License(StrictModel):
    name: str = Field(min_length=1)
    spdx_id: Literal["CC-BY-NC-4.0", "CC-BY-NC-ND-4.0"]
    url: AnyHttpUrl
    scope: str = Field(min_length=1)
    noncommercial: Literal[True]


class Rights(StrictModel):
    dataset: License
    publication: License

    @model_validator(mode="after")
    def preserve_distinct_rights(self) -> Self:
        if self.dataset.spdx_id != "CC-BY-NC-4.0":
            raise ValueError("PAIP dataset rights must remain CC BY-NC 4.0")
        if self.publication.spdx_id != "CC-BY-NC-ND-4.0":
            raise ValueError("the challenge paper has separate CC BY-NC-ND 4.0 rights")
        return self


class Institution(StrictModel):
    id: Literal["snuh", "snubh", "smg-snu-bmc"]
    name: str = Field(min_length=1)


class Cohort(StrictModel):
    organ: Literal["liver"]
    histology: Literal["hepatocellular carcinoma"]
    case_identifier: str = Field(min_length=1)
    patient_case_relation: str = Field(min_length=1)
    collection_period: Literal["2005 through June 2018"]
    case_level_institution_available: Literal[False]
    source_institutions: list[Institution]
    additional_clinicopathologic_data_provided: Literal[False]

    @model_validator(mode="after")
    def require_publisher_institutions(self) -> Self:
        if {item.id for item in self.source_institutions} != {"snuh", "snubh", "smg-snu-bmc"}:
            raise ValueError("PAIP institution scope differs from the official dataset page")
        return self


class Imaging(StrictModel):
    stain: Literal["hematoxylin and eosin"]
    scanner: Literal["Aperio AT2"]
    format: Literal["svs"]
    nominal_magnification: Literal[20]
    micrometres_per_pixel: None
    physical_scale_policy: str = Field(min_length=1)


ArtifactKind = Literal["whole_slide", "xml_annotation", "whole_tumor_mask", "viable_tumor_mask"]
SourceRole = Literal["training", "validation", "test"]


class PublisherRole(StrictModel):
    role: SourceRole
    case_count: int = Field(gt=0)
    specimen: Literal["resection", "resection_or_biopsy"]
    released_artifacts: list[ArtifactKind]
    released_measurements: list[
        Literal[
            "whole_tumor_area_mm2",
            "viable_tumor_area_mm2",
            "viable_tumor_burden_percent",
        ]
    ]
    ground_truth_status: Literal["released", "held_by_challenge_committee"]


class RegionSemantics(StrictModel):
    annotation_id: Literal["1", "2"]
    negative_roa: bool
    name: Literal["whole_tumor_area", "viable_tumor_area", "negative_pen_region"]


class MaskGeneration(StrictModel):
    tissue_background_rgb_threshold: tuple[Literal[235], Literal[210], Literal[235]]
    fills_closed_xml_polygons: Literal[True]
    fills_tissue_holes: Literal[True]
    removes_tissue_components_smaller_than_pixels: Literal[10]
    multiplies_preliminary_roi_masks_by_tissue_mask: Literal[True]


class Annotations(StrictModel):
    xml_status: Literal["reference_annotation"]
    ground_truth: Literal["publisher_binary_tif_masks"]
    xml_coordinate_frame: Literal["aperio_imagescope_slide_coordinates"]
    regions: list[RegionSemantics]
    negative_pen_policy: str = Field(min_length=1)
    mask_generation: MaskGeneration

    @model_validator(mode="after")
    def require_native_regions(self) -> Self:
        regions = {(item.annotation_id, item.negative_roa, item.name) for item in self.regions}
        expected = {
            ("1", False, "whole_tumor_area"),
            ("2", False, "viable_tumor_area"),
            ("2", True, "negative_pen_region"),
        }
        if len(self.regions) != 3 or regions != expected:
            raise ValueError("PAIP XML region semantics are incomplete")
        return self


class Interfaces(StrictModel):
    record_reference_template: Literal["paip2019:<publisher-case-id>"]
    artifact_reference_template: Literal["paip2019:<publisher-case-id>:<artifact-kind>"]
    native_index_path: Literal["outputs/private/native-index.jsonl"]
    ownership: str = Field(min_length=1)


class SourceManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["paip2019-liver-cancer-segmentation"]
    title: str = Field(min_length=1)
    source: SourceReference
    access: AccessPolicy
    rights: Rights
    citation: str = Field(min_length=1)
    cohort: Cohort
    imaging: Imaging
    publisher_roles: list[PublisherRole]
    annotations: Annotations
    interfaces: Interfaces

    @model_validator(mode="after")
    def require_official_roles(self) -> Self:
        counts = {item.role: item.case_count for item in self.publisher_roles}
        if len(self.publisher_roles) != 3 or counts != {
            "training": 50,
            "validation": 10,
            "test": 40,
        }:
            raise ValueError(
                "PAIP publisher role counts must be 50 training, 10 validation, 40 test"
            )
        training = next(item for item in self.publisher_roles if item.role == "training")
        if set(training.released_artifacts) != {
            "whole_slide",
            "xml_annotation",
            "whole_tumor_mask",
            "viable_tumor_mask",
        }:
            raise ValueError("PAIP training artifacts are incomplete")
        if (
            set(training.released_measurements)
            != {
                "whole_tumor_area_mm2",
                "viable_tumor_area_mm2",
                "viable_tumor_burden_percent",
            }
            or training.ground_truth_status != "released"
        ):
            raise ValueError("PAIP training measurements and ground-truth status are incomplete")
        for item in self.publisher_roles:
            if item.role != "training" and (
                item.released_artifacts != ["whole_slide"]
                or item.released_measurements
                or item.ground_truth_status != "held_by_challenge_committee"
            ):
                raise ValueError("PAIP held-out roles release whole slides without ground truth")
        return self


class PublisherMeasurements(StrictModel):
    whole_tumor_area_mm2: float = Field(gt=0)
    viable_tumor_area_mm2: float = Field(ge=0)
    viable_tumor_burden_percent: float = Field(ge=0, le=100)


class NativeCaseReceipt(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    case_id: str = Field(pattern=SOURCE_ID_PATTERN)
    slide_id: str = Field(pattern=SOURCE_ID_PATTERN)
    source_role: SourceRole
    institution_id: Literal["snuh", "snubh", "smg-snu-bmc"] | None
    slide_path: str
    xml_annotation_path: str | None = None
    whole_tumor_mask_path: str | None = None
    viable_tumor_mask_path: str | None = None
    publisher_measurements: PublisherMeasurements | None = None

    @field_validator(
        "slide_path", "xml_annotation_path", "whole_tumor_mask_path", "viable_tumor_mask_path"
    )
    @classmethod
    def require_normalized_relative_path(cls, value: str | None) -> str | None:
        if value is None:
            return None
        parts = value.split("/")
        if value.startswith("/") or ".." in parts or "." in parts or "" in parts:
            raise ValueError("artifact paths must be normalized project-relative paths")
        if parts[:2] != ["data", "native"]:
            raise ValueError("source artifacts must remain under data/native")
        return value

    @model_validator(mode="after")
    def require_role_artifacts(self) -> Self:
        ground_truth = (
            self.xml_annotation_path,
            self.whole_tumor_mask_path,
            self.viable_tumor_mask_path,
            self.publisher_measurements,
        )
        if self.source_role == "training" and any(value is None for value in ground_truth):
            raise ValueError("training cases require XML, both masks, and publisher measurements")
        if self.source_role != "training" and any(value is not None for value in ground_truth):
            raise ValueError("held-out PAIP roles must not expose committee-held ground truth")
        return self


class ImageGeometry(StrictModel):
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    coordinate_frame: Literal["aperio_svs_level_0_pixels", "publisher_binary_mask_raster"]


class ArtifactEvidence(StrictModel):
    artifact_ref: str = Field(min_length=1)
    kind: ArtifactKind
    path: str = Field(min_length=1)
    bytes: int = Field(gt=0)
    sha256: str = Field(pattern=SHA256_PATTERN)
    format: Literal["svs", "xml", "tif"]
    geometry: ImageGeometry | None


class SlideScale(StrictModel):
    nominal_magnification: Literal[20]
    micrometres_per_pixel_x: float | None = Field(default=None, gt=0)
    micrometres_per_pixel_y: float | None = Field(default=None, gt=0)
    basis: Literal["publisher_nominal_magnification_and_svs_metadata"]


class XmlRegionCounts(StrictModel):
    coordinate_frame: Literal["aperio_imagescope_slide_coordinates"]
    whole_tumor_area: int = Field(ge=0)
    viable_tumor_area: int = Field(ge=0)
    negative_pen_region: int = Field(ge=0)


class NativeCaseRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: Literal["paip2019-liver-cancer-segmentation"]
    record_ref: str = Field(min_length=1)
    case_id: str = Field(min_length=1)
    slide_id: str = Field(min_length=1)
    source_role: SourceRole
    institution_id: Literal["snuh", "snubh", "smg-snu-bmc"] | None
    stain: Literal["hematoxylin and eosin"]
    scanner: Literal["Aperio AT2"]
    slide_scale: SlideScale
    artifacts: list[ArtifactEvidence]
    xml_regions: XmlRegionCounts | None
    publisher_measurements: PublisherMeasurements | None
