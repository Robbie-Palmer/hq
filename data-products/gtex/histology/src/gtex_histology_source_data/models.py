from __future__ import annotations

from datetime import date
from typing import Literal, Self

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Artifact(StrictModel):
    name: str = Field(min_length=1)
    url: AnyHttpUrl
    bytes: int = Field(gt=0)
    md5: str = Field(pattern=r"^[a-f0-9]{32}$")
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    media_type: str = Field(min_length=1)


class Snapshot(StrictModel):
    name: Literal["gtex_histology_api", "anvil_svs", "idc_series", "idc_instances"]
    endpoint: AnyHttpUrl
    expected_records: int = Field(gt=0)
    canonical_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class PublisherIdentity(StrictModel):
    name: str = Field(min_length=1)
    record_url: AnyHttpUrl
    release: str = Field(min_length=1)
    role: str = Field(min_length=1)
    access: str = Field(min_length=1)
    counts: dict[str, int]
    rights: dict[str, str | None]


class CollectionContext(StrictModel):
    tissue_samples: Literal[26468]
    donors: Literal[956]
    tissue_types: str
    diagnostic_scope: Literal["non-diseased reference collection, not a diagnostic cancer cohort"]


class Preparation(StrictModel):
    procurement_relationship: str
    histology_block: str
    molecular_block: str
    fixative: Literal["PAXgene Tissue Fixative (Qiagen)"]
    published_fixation_hours_min: Literal[6]
    published_fixation_hours_max: Literal[24]
    stabilizer: Literal["PAXgene Tissue Stabilizer (Qiagen)"]
    embedding: Literal["paraffin"]
    stain: Literal["hematoxylin and eosin"]
    scanner: Literal["Aperio ScanScope (Leica Biosystems)"]
    pathology_reviewers: Literal[4]


class SourceManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["gtex-histology-source-idc-v25-2026-11-11"]
    snapshot_date: date
    title: str = Field(min_length=1)
    collection_context: CollectionContext
    preparation: Preparation
    identities: list[PublisherIdentity]
    snapshots: list[Snapshot]
    static_artifacts: list[Artifact]
    scope: dict[str, list[str]]

    @model_validator(mode="after")
    def require_source_contract(self) -> Self:
        identities = {identity.name: identity for identity in self.identities}
        if set(identities) != {
            "AnVIL Data Explorer",
            "GTEx Portal",
            "Imaging Data Commons",
            "NCI Biospecimen Research Database",
            "Zenodo",
        }:
            raise ValueError("manifest must pin all five publisher identities")
        if identities["Imaging Data Commons"].counts.get("series") != 25503:
            raise ValueError("IDC series count must remain distinct from the GTEx API count")
        if identities["GTEx Portal"].counts.get("histology_api_records") != 25713:
            raise ValueError("GTEx histology API count must remain distinct from IDC")
        if identities["AnVIL Data Explorer"].counts.get("svs_files") != 25708:
            raise ValueError("AnVIL SVS inventory count must retain its own snapshot value")
        if len({snapshot.name for snapshot in self.snapshots}) != 4:
            raise ValueError("all four metadata snapshots must be pinned")
        if len({artifact.name for artifact in self.static_artifacts}) != len(self.static_artifacts):
            raise ValueError("static artifact names must be unique")
        return self


class AcquisitionFile(StrictModel):
    name: str
    records: int | None = None
    bytes: int = Field(ge=0)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class AcquisitionEvidence(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: str
    files: list[AcquisitionFile]


class HistologyRecord(StrictModel):
    histology_image_id: str
    subject_id: str
    tissue_sample_id: str | None
    molecular_sample_id: str | None
    tissue_site_detail: str
    sex: str
    age_bracket: str
    hardy_scale: str
    pathology_notes: str | None
    pathology_categories: list[str]
    hidden: bool


class MolecularRecord(StrictModel):
    sample_id: str
    subject_id: str | None
    tissue_sample_id: str
    aliquot_id: str
    autolysis_score: int | None
    collection_site: str | None
    pathology_notes: str | None
    rin: float | None
    tissue_type: str | None
    tissue_site_detail: str | None
    uberon_id: str | None
    total_ischemic_time_minutes: int | None
    paxgene_fixative_time_minutes: int | None
    nucleic_acid_isolation_batch_id: str | None
    nucleic_acid_isolation_batch_type: str | None
    nucleic_acid_isolation_batch_date: str | None
    genotype_expression_batch_id: str | None
    genotype_expression_batch_date: str | None
    genotype_expression_batch_type: str | None
    analysis_freeze: str | None
    age_bracket: str | None
    sex_code: int | None
    hardy_scale_code: int | None
    missing_fields: list[str]
