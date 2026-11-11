from __future__ import annotations

from typing import Annotated, Literal, Self

from pydantic import AnyUrl, BaseModel, ConfigDict, Field, UrlConstraints, model_validator

HttpsUrl = Annotated[AnyUrl, UrlConstraints(allowed_schemes=["https"])]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Paper(StrictModel):
    title: str = Field(min_length=1)
    identifier: Literal["arXiv:2003.10778"]
    url: HttpsUrl


class License(StrictModel):
    spdx_id: Literal["CC-BY-NC-SA-4.0"]
    url: HttpsUrl
    evidence_url: HttpsUrl
    use_limitation: str = Field(min_length=1)
    redistribution: str = Field(min_length=1)


class SourceArchive(StrictModel):
    fold: int = Field(ge=1, le=3)
    filename: str = Field(pattern=r"^fold_[123]\.zip$")
    url: HttpsUrl
    bytes: int = Field(gt=0)
    sha1: str = Field(pattern=r"^[0-9a-f]{40}$")
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    publisher_etag: str = Field(pattern=r"^[0-9a-f]{40}$")
    publisher_last_modified: str = Field(min_length=1)
    publisher_content_type: str = Field(min_length=1)
    record_count: int = Field(gt=0)

    @model_validator(mode="after")
    def match_fold_and_etag(self) -> Self:
        if self.filename != f"fold_{self.fold}.zip":
            raise ValueError("archive filename must match its publisher fold")
        if self.publisher_etag != self.sha1:
            raise ValueError("publisher ETag must match the verified archive SHA-1")
        return self


class PublisherRoleArrangement(StrictModel):
    arrangement: int = Field(ge=1, le=3)
    training_fold: int = Field(ge=1, le=3)
    validation_fold: int = Field(ge=1, le=3)
    testing_fold: int = Field(ge=1, le=3)

    @model_validator(mode="after")
    def require_distinct_folds(self) -> Self:
        if {self.training_fold, self.validation_fold, self.testing_fold} != {1, 2, 3}:
            raise ValueError("each publisher role arrangement must use every fold once")
        return self


class CellClassChannel(StrictModel):
    channel_index: int = Field(ge=0, le=5)
    publisher_name: str = Field(min_length=1)
    publisher_readme_value: int = Field(ge=0, le=6)
    is_background: bool


class ArrayContract(StrictModel):
    height: int = Field(gt=0)
    width: int = Field(gt=0)
    image_channels: Literal[3]
    mask_channels: Literal[6]
    dtype: Literal["float64"]
    instance_id_semantics: str = Field(min_length=1)
    cell_class_channels: list[CellClassChannel]

    @model_validator(mode="after")
    def require_native_channels(self) -> Self:
        if [channel.channel_index for channel in self.cell_class_channels] != list(range(6)):
            raise ValueError("PanNuke mask channels must remain in publisher order")
        background = [channel for channel in self.cell_class_channels if channel.is_background]
        if len(background) != 1 or background[0].channel_index != 5:
            raise ValueError("PanNuke channel 5 must remain the only background channel")
        return self


class SourceManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["pannuke-publisher-folds-202003"]
    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    source_version: str = Field(min_length=1)
    publisher: str = Field(min_length=1)
    publisher_record: HttpsUrl
    paper: Paper
    license: License
    checksum_provenance: str = Field(min_length=1)
    archives: list[SourceArchive]
    publisher_role_arrangements: list[PublisherRoleArrangement]
    array_contract: ArrayContract
    tissue_identities: list[str]
    identity_evidence: str = Field(min_length=1)

    @model_validator(mode="after")
    def require_complete_native_contract(self) -> Self:
        if [archive.fold for archive in self.archives] != [1, 2, 3]:
            raise ValueError("PanNuke archives must preserve publisher folds 1, 2, and 3")
        if [item.arrangement for item in self.publisher_role_arrangements] != [1, 2, 3]:
            raise ValueError("PanNuke must preserve all three publisher role arrangements")
        if len(self.tissue_identities) != 19 or len(set(self.tissue_identities)) != 19:
            raise ValueError("PanNuke must preserve 19 unique publisher tissue identities")
        return self


class PublisherArchiveMetadata(StrictModel):
    fold: int = Field(ge=1, le=3)
    url: str
    bytes: int = Field(gt=0)
    etag: str
    last_modified: str
    content_type: str


class PublisherMetadataEvidence(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: Literal["pannuke-publisher-folds-202003"]
    archives: list[PublisherArchiveMetadata]


class NativeArrayReference(StrictModel):
    archive_filename: str
    archive_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    member: str
    array_index: int = Field(ge=0)
    element_shape: tuple[int, ...]
    dtype: Literal["float64"]


class NativeRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: Literal["pannuke-publisher-folds-202003"]
    repository_record_id: str = Field(pattern=r"^pannuke:fold-[123]:[0-9]{6}$")
    source_fold: int = Field(ge=1, le=3)
    source_index: int = Field(ge=0)
    tissue_identity: str = Field(min_length=1)
    publisher_roles: dict[str, Literal["training", "validation", "testing"]]
    image_artifact: NativeArrayReference
    instance_mask_annotation: NativeArrayReference
