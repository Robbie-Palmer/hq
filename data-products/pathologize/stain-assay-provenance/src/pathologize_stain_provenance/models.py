from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Any, Literal, Self

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator

ID_PATTERN = r"^[a-z0-9][a-z0-9:._/-]+$"
SHA256_PATTERN = r"^[0-9a-f]{64}$"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class AccessMode(StrEnum):
    PUBLIC = "public"
    GATED = "gated"
    CONTROLLED = "controlled"
    SYNTHETIC = "synthetic"


class ProductBoundary(StrictModel):
    product_id: str = Field(pattern=ID_PATTERN)
    kind: Literal["source_dataset", "derived"]
    third_party_dataset_id: str | None = Field(default=None, pattern=ID_PATTERN)
    imported_source_product_ids: list[str]

    @model_validator(mode="after")
    def enforce_one_dataset_per_source_product(self) -> Self:
        if self.kind == "source_dataset":
            if self.third_party_dataset_id is None:
                raise ValueError("source products require one third-party dataset ID")
            if self.imported_source_product_ids:
                raise ValueError("source products cannot import another source product")
        else:
            if self.third_party_dataset_id is not None:
                raise ValueError("derived products cannot claim a third-party dataset")
            if not self.imported_source_product_ids:
                raise ValueError("derived products must import a source product")
        if len(self.imported_source_product_ids) != len(set(self.imported_source_product_ids)):
            raise ValueError("imported source product IDs must be unique")
        return self


class StableSourceArtifact(StrictModel):
    artifact_id: str = Field(pattern=ID_PATTERN)
    owner_product_id: str = Field(pattern=ID_PATTERN)
    source_record_id: str = Field(pattern=ID_PATTERN)
    kind: Literal["source_image", "source_annotation", "source_table", "source_manifest"]
    uri: str = Field(min_length=1)
    sha256: str | None = Field(default=None, pattern=SHA256_PATTERN)
    publisher_identifier: str | None = Field(default=None, min_length=1)
    bytes: int | None = Field(default=None, gt=0)
    custody: Literal["reference_only"]

    @model_validator(mode="after")
    def require_stable_identity(self) -> Self:
        if self.sha256 is None and self.publisher_identifier is None:
            raise ValueError("source artifacts require a digest or publisher identifier")
        return self


class DerivationOperation(StrictModel):
    name: str = Field(min_length=1)
    version: str = Field(min_length=1)
    parameters: dict[str, Any] = Field(min_length=1)


class DerivedArtifact(StrictModel):
    artifact_id: str = Field(pattern=ID_PATTERN)
    owner_product_id: str = Field(pattern=ID_PATTERN)
    kind: Literal[
        "annotation",
        "mask",
        "tile",
        "embedding",
        "registration",
        "transformed_image",
    ]
    uri: str = Field(min_length=1)
    sha256: str = Field(pattern=SHA256_PATTERN)
    parent_artifact_ids: list[str] = Field(min_length=1)
    operation: DerivationOperation

    @model_validator(mode="after")
    def parents_are_unique(self) -> Self:
        if len(self.parent_artifact_ids) != len(set(self.parent_artifact_ids)):
            raise ValueError("derived artifact parent references must be unique")
        if self.artifact_id in self.parent_artifact_ids:
            raise ValueError("derived artifacts cannot be their own parent")
        return self


class RightsRecord(StrictModel):
    license_id: str = Field(min_length=1)
    license_name: str = Field(min_length=1)
    evidence_url: AnyHttpUrl
    scope: str = Field(min_length=1)
    redistribution: str = Field(min_length=1)


class AccessRecord(StrictModel):
    mode: AccessMode
    authentication_required: bool
    verification: Literal["metadata_only"]
    asset_distribution: Literal["reference_only"]
    access_evidence_url: AnyHttpUrl
    notes: str = Field(min_length=1)

    @model_validator(mode="after")
    def match_authentication_to_mode(self) -> Self:
        gated = self.mode in {AccessMode.GATED, AccessMode.CONTROLLED}
        if self.authentication_required != gated:
            raise ValueError("gated and controlled sources must require authentication")
        return self


class SourceDataset(StrictModel):
    source_product_id: str = Field(pattern=ID_PATTERN)
    source_dataset_id: str = Field(pattern=ID_PATTERN)
    publisher: str = Field(min_length=1)
    source_version: str = Field(min_length=1)
    landing_page_url: AnyHttpUrl
    fact_evidence_urls: list[AnyHttpUrl] = Field(min_length=1)
    native_semantics: str = Field(min_length=1)
    rights: RightsRecord
    access: AccessRecord


class SourceRecord(StrictModel):
    source_record_id: str = Field(pattern=ID_PATTERN)
    source_dataset_id: str = Field(pattern=ID_PATTERN)
    publisher_record_id: str = Field(min_length=1)
    native_fields: dict[str, Any] = Field(min_length=1)
    artifact_ids: list[str] = Field(min_length=1)


class TissuePreparation(StrictModel):
    fixation: str | None = Field(default=None, min_length=1)
    embedding: str | None = Field(default=None, min_length=1)
    section_thickness_micrometres: float | None = Field(default=None, gt=0)
    preparation_notes: str = Field(min_length=1)
    evidence: str = Field(min_length=1)


class TissueSection(StrictModel):
    section_id: str = Field(pattern=ID_PATTERN)
    specimen_id: str | None = Field(default=None, pattern=ID_PATTERN)
    block_id: str | None = Field(default=None, pattern=ID_PATTERN)
    section_index: int | None = Field(default=None, ge=0)
    identity_basis: str = Field(min_length=1)
    preparation: TissuePreparation


class Reagent(StrictModel):
    name: str = Field(min_length=1)
    role: str = Field(min_length=1)
    source_term: str | None = Field(default=None, min_length=1)


class Marker(StrictModel):
    target: str = Field(min_length=1)
    antibody: str | None = Field(default=None, min_length=1)
    clone: str | None = Field(default=None, min_length=1)


class Probe(StrictModel):
    target: str = Field(min_length=1)
    probe: str = Field(min_length=1)


class Chromogen(StrictModel):
    name: str = Field(min_length=1)
    colour: str | None = Field(default=None, min_length=1)


class Fluorophore(StrictModel):
    name: str = Field(min_length=1)
    excitation_nanometres: float | None = Field(default=None, gt=0)
    emission_nanometres: float | None = Field(default=None, gt=0)


class FluorescenceChannel(StrictModel):
    channel_id: str = Field(pattern=ID_PATTERN)
    target: str = Field(min_length=1)
    marker: Marker | None = None
    fluorophore: Fluorophore


class HEAssay(StrictModel):
    kind: Literal["he"]
    protocol_id: str = Field(min_length=1)
    hematoxylin: Reagent
    eosin: Reagent


class IHCAssay(StrictModel):
    kind: Literal["ihc"]
    protocol_id: str = Field(min_length=1)
    markers: list[Marker] = Field(min_length=1)
    chromogens: list[Chromogen] = Field(min_length=1)
    counterstains: list[Reagent]


class IFAssay(StrictModel):
    kind: Literal["if"]
    protocol_id: str = Field(min_length=1)
    channels: list[FluorescenceChannel] = Field(min_length=1)
    cycles: int = Field(default=1, ge=1)

    @model_validator(mode="after")
    def channel_ids_are_unique(self) -> Self:
        ids = [channel.channel_id for channel in self.channels]
        if len(ids) != len(set(ids)):
            raise ValueError("IF channel IDs must be unique")
        return self


class CISHAssay(StrictModel):
    kind: Literal["cish"]
    protocol_id: str = Field(min_length=1)
    probes: list[Probe] = Field(min_length=1)
    chromogens: list[Chromogen] = Field(min_length=1)
    counterstains: list[Reagent]


class ModelReference(StrictModel):
    model_id: str = Field(min_length=1)
    version: str = Field(min_length=1)
    weights_sha256: str = Field(pattern=SHA256_PATTERN)


class VirtualStainAssay(StrictModel):
    kind: Literal["virtual"]
    protocol_id: str = Field(min_length=1)
    target_assay_kind: Literal["he", "ihc", "if", "cish"]
    source_image_ids: list[str] = Field(min_length=1)
    model: ModelReference


Assay = Annotated[
    HEAssay | IHCAssay | IFAssay | CISHAssay | VirtualStainAssay,
    Field(discriminator="kind"),
]


class ScannerRecord(StrictModel):
    manufacturer: str | None = Field(default=None, min_length=1)
    model: str | None = Field(default=None, min_length=1)
    identifier: str | None = Field(default=None, min_length=1)
    not_reported_fields: list[Literal["manufacturer", "model", "identifier"]]
    evidence: str = Field(min_length=1)

    @model_validator(mode="after")
    def list_exactly_the_missing_fields(self) -> Self:
        values = {
            "manufacturer": self.manufacturer,
            "model": self.model,
            "identifier": self.identifier,
        }
        missing = {name for name, value in values.items() if value is None}
        if missing != set(self.not_reported_fields):
            raise ValueError("scanner not_reported_fields must list exactly the missing fields")
        return self


class PhysicalScale(StrictModel):
    micrometres_per_pixel_x: float | None = Field(default=None, gt=0)
    micrometres_per_pixel_y: float | None = Field(default=None, gt=0)
    basis: Literal["source_metadata", "measured", "not_reported"]
    evidence: str = Field(min_length=1)

    @model_validator(mode="after")
    def require_both_axes_or_neither(self) -> Self:
        has_x = self.micrometres_per_pixel_x is not None
        has_y = self.micrometres_per_pixel_y is not None
        if has_x != has_y:
            raise ValueError("physical scale requires both pixel axes")
        if self.basis == "not_reported" and has_x:
            raise ValueError("not-reported physical scale cannot contain values")
        if self.basis != "not_reported" and not has_x:
            raise ValueError("reported or measured physical scale requires values")
        return self


class ImageRecord(StrictModel):
    image_id: str = Field(pattern=ID_PATTERN)
    source_record_id: str = Field(pattern=ID_PATTERN)
    artifact_id: str = Field(pattern=ID_PATTERN)
    section_id: str = Field(pattern=ID_PATTERN)
    image_scope: Literal["field_of_view", "patch", "whole_slide", "derived_image"]
    assay: Assay
    scanner: ScannerRecord
    physical_scale: PhysicalScale


class RegistrationTransform(StrictModel):
    transform_kind: Literal["rigid", "affine", "deformable", "composite"]
    artifact_id: str = Field(pattern=ID_PATTERN)
    coordinate_space: str = Field(min_length=1)


class SameSectionRestained(StrictModel):
    relation_id: str = Field(pattern=ID_PATTERN)
    kind: Literal["same_section_restained"]
    earlier_image_id: str = Field(pattern=ID_PATTERN)
    later_image_id: str = Field(pattern=ID_PATTERN)
    intervening_process: str = Field(min_length=1)


class SerialSections(StrictModel):
    relation_id: str = Field(pattern=ID_PATTERN)
    kind: Literal["serial_sections"]
    first_image_id: str = Field(pattern=ID_PATTERN)
    second_image_id: str = Field(pattern=ID_PATTERN)
    order_basis: str = Field(min_length=1)


class IndependentSpecimens(StrictModel):
    relation_id: str = Field(pattern=ID_PATTERN)
    kind: Literal["independent_specimens"]
    first_image_id: str = Field(pattern=ID_PATTERN)
    second_image_id: str = Field(pattern=ID_PATTERN)
    comparison_basis: str = Field(min_length=1)


class RegisteredPair(StrictModel):
    relation_id: str = Field(pattern=ID_PATTERN)
    kind: Literal["registered_pair"]
    fixed_image_id: str = Field(pattern=ID_PATTERN)
    moving_image_id: str = Field(pattern=ID_PATTERN)
    tissue_relation_id: str = Field(pattern=ID_PATTERN)
    transform: RegistrationTransform


Relation = Annotated[
    SameSectionRestained | SerialSections | IndependentSpecimens | RegisteredPair,
    Field(discriminator="kind"),
]


class ManualAnnotationProvenance(StrictModel):
    kind: Literal["manual"]
    source_image_ids: list[str] = Field(min_length=1)
    protocol: str = Field(min_length=1)
    annotator_roles: list[str] = Field(min_length=1)
    assistance: Literal["none", "algorithmic_suggestions", "assay_reference"]


class AssayDerivedAnnotationProvenance(StrictModel):
    kind: Literal["assay_derived"]
    source_image_ids: list[str] = Field(min_length=1)
    generating_image_id: str = Field(pattern=ID_PATTERN)
    derivation_rule: str = Field(min_length=1)


class ModelDerivedAnnotationProvenance(StrictModel):
    kind: Literal["model_derived"]
    source_image_ids: list[str] = Field(min_length=1)
    model: ModelReference
    inference_protocol: str = Field(min_length=1)


AnnotationProvenance = Annotated[
    ManualAnnotationProvenance
    | AssayDerivedAnnotationProvenance
    | ModelDerivedAnnotationProvenance,
    Field(discriminator="kind"),
]


class AnnotationSet(StrictModel):
    annotation_id: str = Field(pattern=ID_PATTERN)
    artifact_id: str = Field(pattern=ID_PATTERN)
    label_schema_id: str = Field(min_length=1)
    provenance: AnnotationProvenance


class ProvenanceContract(StrictModel):
    schema_version: Literal["1.0.0"]
    contract_id: str = Field(pattern=ID_PATTERN)
    product: ProductBoundary
    source_datasets: list[SourceDataset] = Field(min_length=1)
    source_records: list[SourceRecord] = Field(min_length=1)
    source_artifacts: list[StableSourceArtifact] = Field(min_length=1)
    derived_artifacts: list[DerivedArtifact]
    sections: list[TissueSection] = Field(min_length=1)
    images: list[ImageRecord] = Field(min_length=1)
    relations: list[Relation]
    annotations: list[AnnotationSet]

    @model_validator(mode="after")
    def validate_graph(self) -> Self:
        datasets = _unique_by(self.source_datasets, "source_dataset_id", "source dataset IDs")
        records = _unique_by(self.source_records, "source_record_id", "source record IDs")
        source_artifacts = _unique_by(self.source_artifacts, "artifact_id", "source artifact IDs")
        derived_artifacts = _unique_by(
            self.derived_artifacts, "artifact_id", "derived artifact IDs"
        )
        if set(source_artifacts).intersection(derived_artifacts):
            raise ValueError("source and derived artifact IDs must not overlap")
        artifacts = {**source_artifacts, **derived_artifacts}
        sections = _unique_by(self.sections, "section_id", "section IDs")
        images = _unique_by(self.images, "image_id", "image IDs")
        relations = _unique_by(self.relations, "relation_id", "relation IDs")
        _unique_by(self.annotations, "annotation_id", "annotation IDs")
        _validate_product_boundary(self, datasets)
        _validate_source_records(self, datasets, records, source_artifacts)
        _validate_artifacts(self, records, source_artifacts, derived_artifacts, artifacts)
        _validate_images(self, records, sections, images, artifacts)
        for relation in self.relations:
            _validate_relation(relation, images, sections, relations, derived_artifacts)
        _validate_annotations(self, images, artifacts)
        return self


def _validate_product_boundary(
    contract: ProvenanceContract, datasets: dict[str, SourceDataset]
) -> None:
    source_products = {dataset.source_product_id: dataset for dataset in contract.source_datasets}
    if len(source_products) != len(contract.source_datasets):
        raise ValueError("each third-party dataset must have one source product")
    dataset_ids = list(datasets)
    if contract.product.kind == "source_dataset":
        if set(source_products) != {contract.product.product_id}:
            raise ValueError("a source contract must contain only its own dataset product")
        if contract.product.third_party_dataset_id != dataset_ids[0]:
            raise ValueError("source product dataset ID must match its source dataset")
        if contract.derived_artifacts:
            raise ValueError("source products cannot declare downstream derived artifacts")
    elif set(contract.product.imported_source_product_ids) != set(source_products):
        raise ValueError("derived product imports must match source dataset products")


def _validate_source_records(
    contract: ProvenanceContract,
    datasets: dict[str, SourceDataset],
    records: dict[str, SourceRecord],
    source_artifacts: dict[str, StableSourceArtifact],
) -> None:
    for record in contract.source_records:
        _require_reference(record.source_dataset_id, datasets, "source dataset")
        _require_artifact_references(record.artifact_ids, source_artifacts)
        for artifact_id in record.artifact_ids:
            artifact = source_artifacts[artifact_id]
            dataset = datasets[record.source_dataset_id]
            if artifact.source_record_id != record.source_record_id:
                raise ValueError("source artifact record ID must match its source record")
            if artifact.owner_product_id != dataset.source_product_id:
                raise ValueError("source artifact owner must be its dataset product")
    for artifact in contract.source_artifacts:
        _require_reference(artifact.source_record_id, records, "source record")


def _validate_artifacts(
    contract: ProvenanceContract,
    records: dict[str, SourceRecord],
    source_artifacts: dict[str, StableSourceArtifact],
    derived_artifacts: dict[str, DerivedArtifact],
    artifacts: dict[str, StableSourceArtifact | DerivedArtifact],
) -> None:
    source_products = {dataset.source_product_id: dataset for dataset in contract.source_datasets}
    for artifact in source_artifacts.values():
        _require_reference(artifact.source_record_id, records, "source record")
        if artifact.owner_product_id not in source_products:
            raise ValueError("source artifacts must be owned by an imported source product")
    for artifact in derived_artifacts.values():
        wrong_owner = artifact.owner_product_id != contract.product.product_id
        if contract.product.kind != "derived" or wrong_owner:
            raise ValueError("derived artifacts must be owned by the current derived product")
        _require_artifact_references(artifact.parent_artifact_ids, artifacts)
        parent_digests = {
            parent.sha256
            for parent_id in artifact.parent_artifact_ids
            if (parent := artifacts[parent_id]).sha256 is not None
        }
        if artifact.sha256 in parent_digests:
            raise ValueError("derived artifacts cannot duplicate parent bytes")
    _require_acyclic_derivations(derived_artifacts)


def _validate_images(
    contract: ProvenanceContract,
    records: dict[str, SourceRecord],
    sections: dict[str, TissueSection],
    images: dict[str, ImageRecord],
    artifacts: dict[str, StableSourceArtifact | DerivedArtifact],
) -> None:
    for image in contract.images:
        _require_reference(image.source_record_id, records, "source record")
        _require_reference(image.section_id, sections, "section")
        _require_reference(image.artifact_id, artifacts, "artifact")
        image_artifact = artifacts[image.artifact_id]
        if image_artifact.kind not in {"source_image", "tile", "transformed_image"}:
            message = "images require a source image, tile, or transformed image artifact"
            raise ValueError(message)
        if isinstance(image.assay, VirtualStainAssay):
            _require_image_references(image.assay.source_image_ids, images)
            if image.image_id in image.assay.source_image_ids:
                raise ValueError("virtual stain cannot use itself as a source image")
            valid_artifact = (
                isinstance(image_artifact, DerivedArtifact)
                and image_artifact.kind == "transformed_image"
            )
            if not valid_artifact:
                raise ValueError("virtual stains require an owned transformed image artifact")
            parent_artifact_ids = {
                images[source_image_id].artifact_id
                for source_image_id in image.assay.source_image_ids
            }
            if not parent_artifact_ids.issubset(set(image_artifact.parent_artifact_ids)):
                message = "virtual stain artifact must reference every source image artifact"
                raise ValueError(message)


def _validate_annotations(
    contract: ProvenanceContract,
    images: dict[str, ImageRecord],
    artifacts: dict[str, StableSourceArtifact | DerivedArtifact],
) -> None:
    for annotation in contract.annotations:
        _require_reference(annotation.artifact_id, artifacts, "annotation artifact")
        annotation_artifact = artifacts[annotation.artifact_id]
        if annotation_artifact.kind not in {"source_annotation", "annotation", "mask"}:
            raise ValueError("annotation sets require annotation or mask artifacts")
        _require_image_references(annotation.provenance.source_image_ids, images)
        if isinstance(annotation_artifact, DerivedArtifact):
            source_artifact_ids = {
                images[image_id].artifact_id for image_id in annotation.provenance.source_image_ids
            }
            if not source_artifact_ids.issubset(set(annotation_artifact.parent_artifact_ids)):
                raise ValueError("derived annotation artifact must reference its source images")
        if isinstance(annotation.provenance, AssayDerivedAnnotationProvenance):
            _require_reference(
                annotation.provenance.generating_image_id, images, "generating image"
            )
            if annotation.provenance.generating_image_id not in (
                annotation.provenance.source_image_ids
            ):
                raise ValueError("assay-derived generating image must be a source image")


class EvidenceReference(StrictModel):
    url: AnyHttpUrl
    supports: list[Literal["dataset_fact", "rights", "access"]] = Field(min_length=1)
    note: str = Field(min_length=1)


class FieldMapping(StrictModel):
    source_path: str = Field(min_length=1)
    target_path: str = Field(min_length=1)
    status: Literal["preserved", "derived_with_evidence", "not_available"]
    note: str = Field(min_length=1)
    evidence_url: AnyHttpUrl | None = None

    @model_validator(mode="after")
    def require_evidence_for_derived_values(self) -> Self:
        if self.status == "derived_with_evidence" and self.evidence_url is None:
            raise ValueError("derived mappings require an evidence URL")
        if self.status != "derived_with_evidence" and self.evidence_url is not None:
            raise ValueError("only derived mappings can carry an evidence URL")
        return self


class MigrationMap(StrictModel):
    schema_version: Literal["1.0.0"]
    migration_id: str = Field(pattern=ID_PATTERN)
    existing_product: str = Field(min_length=1)
    source_model: str = Field(min_length=1)
    target_contract: Literal["pathologize.stain-assay-provenance/v1"]
    boundary: Literal["mapping_example_only"]
    authoritative_sources: list[EvidenceReference] = Field(min_length=1)
    mappings: list[FieldMapping] = Field(min_length=1)

    @model_validator(mode="after")
    def require_fact_and_rights_evidence(self) -> Self:
        supported = {kind for source in self.authoritative_sources for kind in source.supports}
        if not {"dataset_fact", "rights"}.issubset(supported):
            raise ValueError("migration maps require primary evidence for facts and rights")
        targets = [mapping.target_path for mapping in self.mappings]
        if len(targets) != len(set(targets)):
            raise ValueError("migration target paths must be unique")
        return self


def _unique_by(items: list[Any], field: str, label: str) -> dict[str, Any]:
    values = [str(getattr(item, field)) for item in items]
    if len(values) != len(set(values)):
        raise ValueError(f"{label} must be unique")
    return dict(zip(values, items, strict=True))


def _require_reference(value: str, items: dict[str, Any], label: str) -> None:
    if value not in items:
        raise ValueError(f"unknown {label}: {value}")


def _require_image_references(values: list[str], images: dict[str, ImageRecord]) -> None:
    if len(values) != len(set(values)):
        raise ValueError("source image references must be unique")
    for value in values:
        _require_reference(value, images, "image")


def _require_artifact_references(values: list[str], artifacts: dict[str, Any]) -> None:
    if len(values) != len(set(values)):
        raise ValueError("artifact references must be unique")
    for value in values:
        _require_reference(value, artifacts, "artifact")


def _require_acyclic_derivations(artifacts: dict[str, DerivedArtifact]) -> None:
    def visit(artifact_id: str, visiting: set[str], visited: set[str]) -> None:
        if artifact_id in visiting:
            raise ValueError("derived artifact lineage must be acyclic")
        if artifact_id in visited:
            return
        visiting.add(artifact_id)
        for parent_id in artifacts[artifact_id].parent_artifact_ids:
            if parent_id in artifacts:
                visit(parent_id, visiting, visited)
        visiting.remove(artifact_id)
        visited.add(artifact_id)

    visited: set[str] = set()
    for artifact_id in artifacts:
        visit(artifact_id, set(), visited)


def _pair(relation: Relation) -> tuple[str, str]:
    if isinstance(relation, SameSectionRestained):
        return relation.earlier_image_id, relation.later_image_id
    if isinstance(relation, SerialSections | IndependentSpecimens):
        return relation.first_image_id, relation.second_image_id
    return relation.fixed_image_id, relation.moving_image_id


def _validate_relation(
    relation: Relation,
    images: dict[str, ImageRecord],
    sections: dict[str, TissueSection],
    relations: dict[str, Relation],
    derived_artifacts: dict[str, DerivedArtifact],
) -> None:
    first_id, second_id = _pair(relation)
    if first_id == second_id:
        raise ValueError("pairing relations require two different images")
    _require_image_references([first_id, second_id], images)
    first_section = sections[images[first_id].section_id]
    second_section = sections[images[second_id].section_id]
    if isinstance(relation, SameSectionRestained):
        if first_section.section_id != second_section.section_id:
            raise ValueError("same-section restaining requires one physical section")
    elif isinstance(relation, SerialSections):
        if first_section.section_id == second_section.section_id:
            raise ValueError("serial sections must use different physical sections")
        if first_section.block_id is None or first_section.block_id != second_section.block_id:
            raise ValueError("serial sections require the same known block")
    elif isinstance(relation, IndependentSpecimens):
        if (
            first_section.specimen_id is None
            or second_section.specimen_id is None
            or first_section.specimen_id == second_section.specimen_id
        ):
            raise ValueError("independent specimens require different known specimen IDs")
    else:
        _validate_registered_pair(relation, images, relations, derived_artifacts)


def _validate_registered_pair(
    relation: RegisteredPair,
    images: dict[str, ImageRecord],
    relations: dict[str, Relation],
    derived_artifacts: dict[str, DerivedArtifact],
) -> None:
    _require_reference(relation.tissue_relation_id, relations, "tissue relation")
    tissue_relation = relations[relation.tissue_relation_id]
    if tissue_relation.kind == "registered_pair":
        raise ValueError("registered pairs must reference a physical tissue relation")
    pair = {relation.fixed_image_id, relation.moving_image_id}
    if set(_pair(tissue_relation)) != pair:
        raise ValueError("registered pair images must match its tissue relation")
    _require_reference(relation.transform.artifact_id, derived_artifacts, "registration artifact")
    transform = derived_artifacts[relation.transform.artifact_id]
    if transform.kind != "registration":
        raise ValueError("registered pairs require an owned registration artifact")
    expected_parents = {images[image_id].artifact_id for image_id in pair}
    if not expected_parents.issubset(set(transform.parent_artifact_ids)):
        raise ValueError("registration artifact must reference both paired images")
