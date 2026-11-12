from __future__ import annotations

from typing import Any, Literal, Self

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SourceModel(BaseModel):
    model_config = ConfigDict(extra="allow", frozen=True)


class ManifestReference(StrictModel):
    file_id: str = Field(pattern=r"^[0-9a-f-]{36}$")
    file_name: str = Field(min_length=1)
    url: AnyHttpUrl


class ReleaseContract(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: str = Field(min_length=1)
    data_release: str = Field(pattern=r"^\d+\.\d+$")
    release_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    api_base_url: AnyHttpUrl
    status_url: AnyHttpUrl
    release_notes_url: AnyHttpUrl
    api_status_commit_observed: str = Field(pattern=r"^[0-9a-f]{40}$")
    official_active_manifest: ManifestReference


class QuerySpec(StrictModel):
    query_id: str = Field(min_length=1)
    record_kind: Literal["diagnostic_slide", "molecular_evidence"]
    endpoint: AnyHttpUrl
    expected_full_release_count: int = Field(gt=0)
    page_size: int = Field(gt=0, le=10_000)
    sort: Literal["file_id:asc"]
    filters: dict[str, Any]
    fields: list[str] = Field(min_length=1)
    expand: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def fields_are_unique(self) -> Self:
        if len(self.fields) != len(set(self.fields)):
            raise ValueError(f"{self.query_id}: query fields must be unique")
        if len(self.expand) != len(set(self.expand)):
            raise ValueError(f"{self.query_id}: query expansions must be unique")
        return self


class QueryContract(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: str = Field(min_length=1)
    queries: list[QuerySpec] = Field(min_length=2, max_length=2)

    @model_validator(mode="after")
    def queries_are_unique(self) -> Self:
        ids = [query.query_id for query in self.queries]
        kinds = [query.record_kind for query in self.queries]
        if len(ids) != len(set(ids)) or len(kinds) != len(set(kinds)):
            raise ValueError("query IDs and record kinds must be unique")
        return self


class AssociatedEntity(SourceModel):
    entity_id: str = Field(min_length=1)
    entity_submitter_id: str | None = None
    entity_type: str = Field(min_length=1)
    case_id: str = Field(min_length=1)


class GdcFile(SourceModel):
    file_id: str = Field(pattern=r"^[0-9a-f-]{36}$")
    file_name: str = Field(min_length=1)
    md5sum: str = Field(pattern=r"^[0-9a-f]{32}$")
    file_size: int = Field(gt=0)
    access: Literal["open", "controlled"]
    data_category: str = Field(min_length=1)
    data_type: str = Field(min_length=1)
    data_format: str = Field(min_length=1)
    experimental_strategy: str | None = None
    stain_type: str | None = None
    analysis: dict[str, Any] | None = None
    associated_entities: list[AssociatedEntity] = Field(min_length=1)
    cases: list[dict[str, Any]] = Field(min_length=1)


class Pagination(SourceModel):
    count: int = Field(ge=0)
    total: int = Field(ge=0)
    size: int = Field(ge=0)
    from_: int = Field(ge=0, alias="from")


class ApiData(SourceModel):
    hits: list[GdcFile]
    pagination: Pagination


class ApiPage(SourceModel):
    data: ApiData


class BiospecimenChain(StrictModel):
    case_id: str
    case_submitter_id: str
    participant_submitter_id: str
    project_id: str
    associated_entity_type: str
    associated_entity_id: str
    associated_entity_submitter_id: str | None
    sample_id: str | None = None
    sample_submitter_id: str | None = None
    sample_type: str | None = None
    specimen_type: str | None = None
    tissue_type: str | None = None
    tumor_descriptor: str | None = None
    portion_id: str | None = None
    portion_submitter_id: str | None = None
    portion_number: str | None = None
    portion_is_ffpe: bool | None = None
    slide_id: str | None = None
    slide_submitter_id: str | None = None
    slide_section_location: str | None = None
    analyte_id: str | None = None
    analyte_submitter_id: str | None = None
    analyte_type: str | None = None
    analyte_experimental_protocol_type: str | None = None
    aliquot_id: str | None = None
    aliquot_submitter_id: str | None = None


class NativeRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: str
    record_id: str
    record_kind: Literal["diagnostic_slide", "molecular_evidence"]
    biospecimen_chains: list[BiospecimenChain] = Field(min_length=1)
    source: dict[str, Any]


class ArtifactReference(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: str
    artifact_id: str
    native_record_id: str
    file_name: str
    source_url: AnyHttpUrl
    bytes: int = Field(gt=0)
    md5: str = Field(pattern=r"^[0-9a-f]{32}$")
    access: Literal["open", "controlled"]
    data_category: str
    data_type: str
    data_format: str
    experimental_strategy: str | None
    workflow_type: str | None


class PartitionAssignment(StrictModel):
    record_id: str
    partition: str = Field(min_length=1)
