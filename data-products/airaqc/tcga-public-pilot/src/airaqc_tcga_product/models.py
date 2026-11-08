from typing import Any

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Access(StrictModel):
    model_config = ConfigDict(extra="allow", frozen=True)

    download_base_urls: list[AnyHttpUrl] = Field(min_length=1)


class Collection(StrictModel):
    model_config = ConfigDict(extra="allow", frozen=True)

    collection_id: str
    access: Access


class Subset(StrictModel):
    model_config = ConfigDict(extra="allow", frozen=True)

    subset_id: str
    collection_id: str
    asset_root: str
    asset_manifest_id: str
    slide_ids: list[str] = Field(min_length=1)
    asset_count: int = Field(gt=0)
    total_bytes: int = Field(gt=0)


class Asset(StrictModel):
    model_config = ConfigDict(extra="allow", frozen=True)

    relative_path: str
    source_url: AnyHttpUrl
    bytes: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    image_role: str


class AssetManifest(StrictModel):
    asset_manifest_id: str
    subset_id: str
    schema_version: int
    assets: list[Asset] = Field(min_length=1)


class CorpusAsset(StrictModel):
    model_config = ConfigDict(extra="allow", frozen=True)

    relative_path: str
    bytes: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class Slide(StrictModel):
    model_config = ConfigDict(extra="allow", frozen=True)

    slide_id: str
    patient_id: str
    source: CorpusAsset
    annotation: CorpusAsset
    annotation_counts: dict[str, int]


class Corpus(StrictModel):
    model_config = ConfigDict(extra="allow", frozen=True)

    corpus_id: str
    slides: list[Slide] = Field(min_length=1)
    provenance: dict[str, Any]
