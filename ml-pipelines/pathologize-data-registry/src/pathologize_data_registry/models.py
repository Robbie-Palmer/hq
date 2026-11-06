from __future__ import annotations

from collections.abc import Iterable
from datetime import date
from typing import Literal
from urllib.parse import urlsplit

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, field_validator, model_validator

ID_PATTERN = r"^[a-z0-9][a-z0-9:.-]+$"
PATH_PATTERN = r"^[a-zA-Z0-9][a-zA-Z0-9._/-]+$"
UID_PATTERN = r"^[0-9]+(?:\.[0-9]+)+$"
SHA256_PATTERN = r"^[0-9a-f]{64}$"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


def require_relative_path(value: str) -> str:
    parts = value.split("/")
    if value.startswith("/") or ".." in parts or "." in parts or "" in parts:
        raise ValueError("must be a normalized project-relative path")
    return value


def source_url_is_allowlisted(source_url: str, base_urls: Iterable[str]) -> bool:
    source = urlsplit(source_url)
    if source.scheme != "https" or source.hostname is None:
        return False
    for base_url in base_urls:
        base = urlsplit(base_url)
        if (
            base.scheme == "https"
            and base.hostname == source.hostname
            and base.port == source.port
            and source.path.startswith(base.path)
        ):
            return True
    return False


class RegistryOwnership(StrictModel):
    owns: list[str] = Field(min_length=1)
    excludes: list[str] = Field(min_length=1)


class RegistryIndex(StrictModel):
    schema_version: Literal[1]
    registry_id: str = Field(pattern=ID_PATTERN)
    description: str = Field(min_length=1)
    collections: list[str] = Field(min_length=1)
    subsets: list[str]
    asset_manifests: list[str]
    slide_records: list[str]
    ownership: RegistryOwnership

    @field_validator("collections", "subsets", "asset_manifests", "slide_records")
    @classmethod
    def validate_paths(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("paths must be unique")
        return [require_relative_path(value) for value in values]


class SourceReference(StrictModel):
    publisher: str = Field(min_length=1)
    landing_page_url: AnyHttpUrl
    documentation_urls: list[AnyHttpUrl] = Field(min_length=1)
    doi: str | None
    source_version: str = Field(min_length=1)
    retrieved_at: date

    @field_validator("doi")
    @classmethod
    def validate_doi(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith("10."):
            raise ValueError("must be a DOI beginning with 10.")
        return value


class AccessPolicy(StrictModel):
    public: bool
    authentication_required: bool
    automated_access: bool
    acquisition_policy: Literal["automated_bounded", "manifest_only"]
    reason: str = Field(min_length=1)
    download_base_urls: list[AnyHttpUrl]

    @model_validator(mode="after")
    def validate_automation(self) -> AccessPolicy:
        if any(url.scheme != "https" for url in self.download_base_urls):
            raise ValueError("download base URLs must use HTTPS")
        if self.acquisition_policy == "automated_bounded":
            if not self.public or self.authentication_required or not self.automated_access:
                raise ValueError("automated acquisition requires anonymous public automated access")
            if not self.download_base_urls:
                raise ValueError("automated acquisition requires an allowlisted download base URL")
            if any(not (url.path or "").endswith("/") for url in self.download_base_urls):
                raise ValueError("download base URLs must identify a path prefix ending in /")
        elif self.download_base_urls:
            raise ValueError("manifest-only collections must not expose acquisition base URLs")
        return self


class LicenseRecord(StrictModel):
    name: str = Field(min_length=1)
    spdx_id: str = Field(pattern=r"^[A-Za-z0-9.-]+$")
    url: AnyHttpUrl
    scope: str = Field(min_length=1)
    redistribution: str = Field(min_length=1)


class KnownScale(StrictModel):
    slides_or_series: int = Field(gt=0)
    bytes: int | None = Field(default=None, gt=0)
    basis: str = Field(min_length=1)


class CollectionManifest(StrictModel):
    schema_version: Literal[1]
    collection_id: str = Field(pattern=ID_PATTERN)
    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    registration_status: Literal["acquired_subset", "manifest_only"]
    source: SourceReference
    access: AccessPolicy
    license: LicenseRecord
    citation: str = Field(min_length=1)
    known_scale: KnownScale
    source_native_label_domains: list[str] = Field(min_length=1)
    subsets: list[str]

    @model_validator(mode="after")
    def validate_status(self) -> CollectionManifest:
        if self.registration_status == "manifest_only":
            if self.subsets:
                raise ValueError("manifest-only collections cannot declare acquired subsets")
            if self.access.acquisition_policy != "manifest_only":
                raise ValueError(
                    "manifest-only registration requires a manifest-only access policy"
                )
        elif not self.subsets:
            raise ValueError("acquired-subset collections must list at least one subset")
        return self


class SubsetSelection(StrictModel):
    method: str = Field(min_length=1)
    source_index_version: str = Field(min_length=1)
    selected_at: date
    task_split: None = None


class SubsetManifest(StrictModel):
    schema_version: Literal[1]
    subset_id: str = Field(pattern=ID_PATTERN)
    collection_id: str = Field(pattern=ID_PATTERN)
    description: str = Field(min_length=1)
    selection: SubsetSelection
    asset_root: str = Field(pattern=PATH_PATTERN)
    asset_manifest_id: str = Field(pattern=ID_PATTERN)
    slide_ids: list[str] = Field(min_length=1)
    asset_count: int = Field(gt=0)
    total_bytes: int = Field(gt=0)

    @field_validator("asset_root")
    @classmethod
    def validate_asset_root(cls, value: str) -> str:
        normalized = require_relative_path(value)
        if not normalized.startswith("data/raw/"):
            raise ValueError("must be contained by data/raw")
        return normalized


class AssetRecord(StrictModel):
    relative_path: str = Field(pattern=PATH_PATTERN)
    source_url: AnyHttpUrl
    bytes: int = Field(gt=0)
    sha256: str = Field(pattern=SHA256_PATTERN)
    source_etag: str = Field(pattern=r"^[0-9a-f]{32}$")
    sop_instance_uid: str = Field(pattern=UID_PATTERN)
    image_role: Literal["label", "overview", "thumbnail", "volume_primary", "volume_resampled"]

    @field_validator("relative_path")
    @classmethod
    def validate_relative_path(cls, value: str) -> str:
        return require_relative_path(value)

    @field_validator("source_url")
    @classmethod
    def validate_source_url(cls, value: AnyHttpUrl) -> AnyHttpUrl:
        if value.scheme != "https":
            raise ValueError("source URL must use HTTPS")
        return value


class AssetManifest(StrictModel):
    schema_version: Literal[1]
    asset_manifest_id: str = Field(pattern=ID_PATTERN)
    subset_id: str = Field(pattern=ID_PATTERN)
    assets: list[AssetRecord] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_unique_assets(self) -> AssetManifest:
        paths = [asset.relative_path for asset in self.assets]
        sop_uids = [asset.sop_instance_uid for asset in self.assets]
        if len(paths) != len(set(paths)):
            raise ValueError("asset paths must be unique")
        if len(sop_uids) != len(set(sop_uids)):
            raise ValueError("SOP Instance UIDs must be unique")
        return self


class SourceIdentity(StrictModel):
    patient_id: str = Field(min_length=1)
    case_id: str = Field(min_length=1)
    specimen_id: str = Field(min_length=1)
    specimen_uid: str = Field(pattern=UID_PATTERN)
    slide_container_id: str = Field(min_length=1)
    study_instance_uid: str = Field(pattern=UID_PATTERN)
    series_instance_uid: str = Field(pattern=UID_PATTERN)
    identity_basis: str = Field(min_length=1)


class ScannerMetadata(StrictModel):
    manufacturer: str = Field(min_length=1)
    model: str = Field(min_length=1)
    device_serial_number: str | None = Field(min_length=1)
    objective_power: float = Field(gt=0)
    conversion_note: str = Field(min_length=1)


class PhysicalResolution(StrictModel):
    micrometres_per_pixel_x: float = Field(gt=0)
    micrometres_per_pixel_y: float = Field(gt=0)
    total_pixel_matrix_columns: int = Field(gt=0)
    total_pixel_matrix_rows: int = Field(gt=0)
    source_instance_path: str = Field(pattern=PATH_PATTERN)

    @field_validator("source_instance_path")
    @classmethod
    def validate_source_instance_path(cls, value: str) -> str:
        return require_relative_path(value)


class SourceNativeLabel(StrictModel):
    name: str = Field(pattern=r"^[a-z][a-z0-9_]+$")
    value: str = Field(min_length=1)
    code: str | None
    provenance: str = Field(min_length=1)


class SlideRecord(StrictModel):
    schema_version: Literal[1]
    slide_id: str = Field(pattern=ID_PATTERN)
    collection_id: str = Field(pattern=ID_PATTERN)
    subset_id: str = Field(pattern=ID_PATTERN)
    identity: SourceIdentity
    scanner: ScannerMetadata
    physical_resolution: PhysicalResolution
    source_native_labels: list[SourceNativeLabel] = Field(min_length=1)
    label_limitations: str = Field(min_length=1)
    asset_paths: list[str] = Field(min_length=1)

    @field_validator("asset_paths")
    @classmethod
    def validate_asset_paths(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("slide asset paths must be unique")
        return [require_relative_path(value) for value in values]
