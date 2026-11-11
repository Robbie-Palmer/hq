from __future__ import annotations

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class LabelMapping(StrictModel):
    source_label: str = Field(min_length=1)
    source_values: list[str] = Field(min_length=1)
    target_labels: list[str] = Field(min_length=1)
    status: Literal["exact", "partial", "source_merged", "unmapped", "dropped"]
    rationale: str = Field(min_length=1)


class Adapter(StrictModel):
    schema_version: Literal["1.0.0"]
    adapter_id: str = Field(min_length=1)
    source_kind: Literal["bcss", "segpath", "crc_epithelium"]
    source_dataset_id: str = Field(min_length=1)
    source_interface_version: Literal["1.0.0"]
    target_ontology_id: str = Field(min_length=1)
    coverage_semantics: Literal[
        "exhaustive_multiclass_with_ignore",
        "positive_binary_only",
        "binary_epithelium_mask",
    ]
    expected_image_techniques: list[Literal["H&E", "IHC", "IF", "CISH"]] = Field(min_length=1)
    expected_annotation_techniques: list[Literal["H&E", "IHC", "IF", "CISH"]]
    mappings: list[LabelMapping] = Field(min_length=1)
    limitations: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def unique_source_labels(self) -> Self:
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
    def fractions_sum_to_one(self) -> Self:
        total = self.train_fraction + self.validation_fraction + self.test_fraction
        if abs(total - 1) > 1e-9:
            raise ValueError("split fractions must sum to one")
        return self


class ProductSpec(StrictModel):
    schema_version: Literal["1.0.0"]
    product_id: str = Field(min_length=1)
    description: str = Field(min_length=1)
    ontology_id: str = Field(min_length=1)
    publication_state: Literal["contract_fixture", "published"]
    fixture_data_only: bool
    split_policy: SplitPolicy
    source_role_policy: dict[str, Literal["preserve", "group_hash_when_unassigned"]] = Field(
        min_length=1
    )

    @model_validator(mode="after")
    def fixture_state_is_explicit(self) -> Self:
        if self.fixture_data_only != (self.publication_state == "contract_fixture"):
            raise ValueError("fixture_data_only must match the contract_fixture publication state")
        return self


class AssayProvenance(StrictModel):
    technique: Literal["H&E", "IHC", "IF", "CISH"]
    targets: list[str]
    source_description: str = Field(min_length=1)

    @model_validator(mode="after")
    def technique_targets_are_consistent(self) -> Self:
        if self.technique == "H&E" and self.targets:
            raise ValueError("H&E assay provenance must not claim a molecular target")
        if self.technique != "H&E" and not self.targets:
            raise ValueError(f"{self.technique} assay provenance requires a target")
        return self


class AnnotationProvenance(StrictModel):
    method: Literal[
        "structured_crowdsourcing_consensus",
        "immunofluorescence_restain",
        "pathologist_manual",
    ]
    evidence_assay: AssayProvenance | None
    registered_to_image: bool
    registration_method: str | None

    @model_validator(mode="after")
    def assay_derived_annotation_is_traceable(self) -> Self:
        if self.method == "immunofluorescence_restain":
            if self.evidence_assay is None or self.evidence_assay.technique != "IF":
                raise ValueError("IF-restain annotations require IF evidence assay provenance")
            if not self.registered_to_image or not self.registration_method:
                raise ValueError("IF-restain annotations require registration provenance")
        elif self.evidence_assay is not None or self.registered_to_image:
            raise ValueError("manual annotations cannot claim assay-derived registration")
        return self


class SourceArtifactReference(StrictModel):
    source_dataset_id: str = Field(min_length=1)
    path: str = Field(min_length=1)
    media_type: str = Field(min_length=1)
    checksum_algorithm: Literal["sha256"] = "sha256"
    checksum: str = Field(pattern=r"^[a-f0-9]{64}$")


class HarmonizedRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    product_id: str
    record_id: str
    source_dataset_id: str
    source_record_id: str
    source_group_id: str
    source_role: Literal["train", "validation", "test", "unassigned"]
    product_role: Literal["train", "validation", "test"]
    role_mapping_status: Literal["preserved", "assigned_by_group_hash"]
    organ: str
    source_tissue_role: str | None
    segmentation_scope: Literal["semantic_regions"]
    coverage_semantics: Literal[
        "exhaustive_multiclass_with_ignore",
        "positive_binary_only",
        "binary_epithelium_mask",
    ]
    image_artifact: SourceArtifactReference
    mask_artifact: SourceArtifactReference
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    micrometres_per_pixel: float = Field(gt=0)
    image_assay: AssayProvenance
    annotation_provenance: AnnotationProvenance
    source_labels_present: list[str] = Field(min_length=1)
    target_labels_present: list[str] = Field(min_length=1)
    mapping_statuses: dict[str, Literal["exact", "partial", "source_merged", "unmapped", "dropped"]]
    adapter_id: str
    source_payload: dict[str, JsonValue]
    fixture_record: bool


class BcssRecord(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["bcss-amgad-2019"]
    roi_id: str
    slide_id: str
    patient_id: str
    organ: Literal["breast"]
    source_role: Literal["train", "validation", "test", "unassigned"]
    image_path: str
    mask_path: str
    image_media_type: Literal["image/png"]
    mask_media_type: Literal["image/png"]
    image_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    mask_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    micrometres_per_pixel: float = Field(gt=0)
    native_labels_present: list[str] = Field(min_length=1)
    image_stain: Literal["H&E"]
    annotation_method: Literal["structured_crowdsourcing_consensus"]


class SegPathRecord(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["segpath-public-v1"]
    patch_id: str
    slide_id: str
    organ: str = Field(min_length=1)
    source_role: Literal["train", "validation", "test"]
    image_path: str
    mask_path: str
    image_media_type: Literal["image/png"]
    mask_media_type: Literal["image/png"]
    image_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    mask_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    micrometres_per_pixel: float = Field(gt=0)
    source_label: str = Field(min_length=1)
    antigen: str = Field(min_length=1)
    image_stain: Literal["H&E"]
    annotation_assay: Literal["IF"]
    registration_method: str = Field(min_length=1)


class CrcEpitheliumRecord(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["crc-ihc-cish-he-epithelium-v1"]
    image_id: str
    core_id: str
    patient_id: str
    organ: Literal["colorectum"]
    tissue_role: Literal["normal_colorectal_mucosa", "colorectal_cancer"]
    source_role: Literal["train", "validation", "test", "unassigned"]
    image_path: str
    mask_path: str
    image_media_type: Literal["image/jpeg", "image/png"]
    mask_media_type: Literal["image/png"]
    image_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    mask_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    micrometres_per_pixel: float = Field(gt=0)
    source_label: Literal["epithelium"]
    image_assay: Literal["H&E", "IHC", "CISH"]
    marker_or_target: str | None
    annotation_method: Literal["pathologist_manual"]

    @model_validator(mode="after")
    def marker_matches_assay(self) -> Self:
        if self.image_assay == "H&E" and self.marker_or_target is not None:
            raise ValueError("H&E colorectal records cannot claim a marker")
        if self.image_assay != "H&E" and not self.marker_or_target:
            raise ValueError(f"{self.image_assay} colorectal records require a marker or target")
        return self
