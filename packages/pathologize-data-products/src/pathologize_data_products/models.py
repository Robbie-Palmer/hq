from __future__ import annotations

from enum import StrEnum
from pathlib import PurePosixPath
from typing import Any, Literal, Self

from pydantic import AnyUrl, BaseModel, ConfigDict, Field, JsonValue, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class AccessTier(StrEnum):
    PUBLIC = "public"
    REGISTRATION_REQUIRED = "registration_required"
    RESTRICTED = "restricted"


class ProductVersion(StrictModel):
    product: str = Field(pattern=r"^[a-z0-9][a-z0-9._/-]*$")
    version: str = Field(min_length=1)


class Checksum(StrictModel):
    algorithm: Literal["sha256"] = "sha256"
    value: str = Field(pattern=r"^[0-9a-f]{64}$")


class Rights(StrictModel):
    license: str = Field(min_length=1)
    redistribution: str = Field(min_length=1)
    evidence_uri: AnyUrl


class CoordinateFrame(StrictModel):
    name: str = Field(min_length=1)
    axes: tuple[str, ...] = Field(min_length=1)
    origin: str = Field(min_length=1)


class PhysicalScale(StrictModel):
    micrometres_per_pixel_x: float = Field(gt=0)
    micrometres_per_pixel_y: float = Field(gt=0)


class ArtifactRole(StrEnum):
    SOURCE_ARCHIVE = "source_archive"
    SOURCE_IMAGE = "source_image"
    SOURCE_ANNOTATION = "source_annotation"
    SOURCE_MASK = "source_mask"
    SOURCE_MANIFEST = "source_manifest"
    SOURCE_RECORDS = "source_records"
    TABLE = "table"
    MANIFEST = "manifest"
    ADAPTER = "adapter"
    PARTITION = "partition"
    REPORT = "report"
    ANNOTATION = "annotation"
    MASK = "mask"
    TILE = "tile"
    EMBEDDING = "embedding"
    REGISTRATION = "registration"
    TRANSFORMED_IMAGE = "transformed_image"
    MEASUREMENT = "measurement"
    BAG = "bag"
    INSTANCE = "instance"
    LABEL_EVIDENCE = "label_evidence"
    FEATURE = "feature"
    MODEL_INPUT = "model_input"


class ArtifactReference(StrictModel):
    product: ProductVersion
    source_record: str = Field(min_length=1)
    role: ArtifactRole
    path: str | None = None
    uri: AnyUrl | None = None
    checksum: Checksum
    media_type: str = Field(pattern=r"^[a-z0-9.+-]+/[a-z0-9.+-]+$")
    rights: Rights
    access_tier: AccessTier
    coordinate_frame: CoordinateFrame | None = None
    physical_scale: PhysicalScale | None = None

    @model_validator(mode="after")
    def require_one_location(self) -> Self:
        if (self.path is None) == (self.uri is None):
            raise ValueError("artifact reference must carry exactly one path or URI")
        if self.path is not None:
            candidate = PurePosixPath(self.path)
            if candidate.is_absolute() or ".." in candidate.parts or self.path == ".":
                raise ValueError("artifact path must stay within its product root")
        if self.media_type.startswith("image/") and self.coordinate_frame is None:
            raise ValueError("image artifacts must declare their coordinate frame")
        if self.physical_scale is not None and self.coordinate_frame is None:
            raise ValueError("physical scale requires a coordinate frame")
        return self


class PublisherIdentity(StrictModel):
    namespace: str = Field(min_length=1)
    value: str = Field(min_length=1)


class Retrieval(StrictModel):
    uri: AnyUrl
    checksum: Checksum


class NativeConcept(StrictModel):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)


class NativeOntology(StrictModel):
    id: str = Field(min_length=1)
    concepts: tuple[NativeConcept, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def concept_ids_are_unique(self) -> Self:
        ids = [concept.id for concept in self.concepts]
        if len(ids) != len(set(ids)):
            raise ValueError("native ontology concept IDs must be unique")
        return self


class SourceProduct(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    kind: Literal["source"] = "source"
    identity: ProductVersion
    third_party_dataset: str = Field(min_length=1)
    publisher_identities: tuple[PublisherIdentity, ...] = Field(min_length=1)
    retrieval: tuple[Retrieval, ...] = Field(min_length=1)
    rights: Rights
    access_tier: AccessTier
    native_ontology: NativeOntology
    publisher_roles: tuple[str, ...] = Field(min_length=1)
    original_artifacts: tuple[ArtifactReference, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def owns_original_artifacts(self) -> Self:
        if any(artifact.product != self.identity for artifact in self.original_artifacts):
            raise ValueError("source product must own every original artifact")
        if len(self.publisher_roles) != len(set(self.publisher_roles)):
            raise ValueError("publisher roles must be unique")
        return self


class PublishedArtifactKind(StrEnum):
    TABLE = "table"
    MANIFEST = "manifest"
    ADAPTER = "adapter"
    PARTITION = "partition"
    REPORT = "report"


class PublishedArtifact(StrictModel):
    kind: PublishedArtifactKind
    reference: ArtifactReference


class DerivedArtifactKind(StrEnum):
    ANNOTATION = "annotation"
    MASK = "mask"
    TILE = "tile"
    EMBEDDING = "embedding"
    REGISTRATION = "registration"
    TRANSFORMED_IMAGE = "transformed_image"
    MEASUREMENT = "measurement"
    BAG = "bag"
    INSTANCE = "instance"
    LABEL_EVIDENCE = "label_evidence"
    FEATURE = "feature"
    MODEL_INPUT = "model_input"


class Operation(StrictModel):
    name: str = Field(min_length=1)
    parameters: dict[str, JsonValue]
    code_revision: str = Field(min_length=1)


class DerivedArtifact(StrictModel):
    artifact_id: str = Field(min_length=1)
    kind: DerivedArtifactKind
    reference: ArtifactReference
    operation: Operation
    parents: tuple[ArtifactReference, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def is_created_by_owning_product(self) -> Self:
        if self.reference in self.parents:
            raise ValueError("derived artifact cannot be its own parent")
        return self


class ComposedRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    product: ProductVersion
    record_id: str = Field(min_length=1)
    upstream_artifacts: tuple[ArtifactReference, ...] = Field(min_length=1)
    derived_artifact_ids: tuple[str, ...] = ()
    adapter: str = Field(min_length=1)
    partition: str = Field(min_length=1)
    attributes: dict[str, JsonValue] = Field(default_factory=dict)

    @model_validator(mode="after")
    def references_upstream_products(self) -> Self:
        if any(artifact.product == self.product for artifact in self.upstream_artifacts):
            raise ValueError("composed records must reference upstream artifacts, not copied bytes")
        if len(self.derived_artifact_ids) != len(set(self.derived_artifact_ids)):
            raise ValueError("derived artifact IDs must be unique within a composed record")
        return self


class DerivedProduct(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    kind: Literal["derived"] = "derived"
    identity: ProductVersion
    upstream_products: tuple[ProductVersion, ...] = Field(min_length=1)
    records: tuple[ComposedRecord, ...]
    published_artifacts: tuple[PublishedArtifact, ...]
    new_artifacts: tuple[DerivedArtifact, ...]

    @model_validator(mode="after")
    def enforce_boundary(self) -> Self:
        upstream_products = set(self.upstream_products)
        if self.identity in upstream_products:
            raise ValueError("derived product cannot import itself")
        if len(upstream_products) != len(self.upstream_products):
            raise ValueError("upstream product pins must be unique")
        artifact_ids = [artifact.artifact_id for artifact in self.new_artifacts]
        if len(artifact_ids) != len(set(artifact_ids)):
            raise ValueError("derived artifact IDs must be unique")
        self._validate_records(upstream_products, set(artifact_ids))
        self._validate_published_artifacts()
        self._validate_new_artifacts(upstream_products)
        return self

    def _validate_records(
        self,
        upstream_products: set[ProductVersion],
        artifact_ids: set[str],
    ) -> None:
        for record in self.records:
            if record.product != self.identity:
                raise ValueError("composed record must belong to the derived product")
            referenced_products = {reference.product for reference in record.upstream_artifacts}
            if not referenced_products <= upstream_products:
                raise ValueError("composed record references an unpinned upstream product")
            if not set(record.derived_artifact_ids) <= artifact_ids:
                raise ValueError("composed record references an unknown derived artifact")

    def _validate_published_artifacts(self) -> None:
        for artifact in self.published_artifacts:
            if artifact.reference.product != self.identity:
                raise ValueError("derived product must own its published contract artifacts")
            if artifact.reference.media_type.startswith("image/"):
                raise ValueError("published contract artifacts cannot copy source image bytes")

    def _validate_new_artifacts(self, upstream_products: set[ProductVersion]) -> None:
        for artifact in self.new_artifacts:
            if artifact.reference.product != self.identity:
                raise ValueError("derived product must own every genuinely new artifact")
            if any(
                parent.product not in upstream_products | {self.identity}
                for parent in artifact.parents
            ):
                raise ValueError("derived artifact has an unpinned parent product")


class MigrationPlan(StrictModel):
    product: ProductVersion
    current_contract: str
    target_contract: str
    bounded_changes: tuple[str, ...] = Field(min_length=1)
    preserved_paths: tuple[str, ...]
    source_byte_policy: Literal["reference_only"] = "reference_only"


def require_unique_source_owners(products: list[SourceProduct]) -> None:
    owners: dict[str, ProductVersion] = {}
    for product in products:
        existing = owners.get(product.third_party_dataset)
        if existing is not None and existing != product.identity:
            raise ValueError(
                f"third-party dataset {product.third_party_dataset!r} has multiple owners: "
                f"{existing.product} and {product.identity.product}"
            )
        owners[product.third_party_dataset] = product.identity


ContractModel = (
    SourceProduct | ArtifactReference | ComposedRecord | DerivedArtifact | DerivedProduct
)


def contract_schemas() -> dict[str, dict[str, Any]]:
    models: dict[str, type[BaseModel]] = {
        "artifact-reference": ArtifactReference,
        "composed-record": ComposedRecord,
        "derived-artifact": DerivedArtifact,
        "derived-product": DerivedProduct,
        "source-product": SourceProduct,
    }
    return {name: model.model_json_schema() for name, model in models.items()}
