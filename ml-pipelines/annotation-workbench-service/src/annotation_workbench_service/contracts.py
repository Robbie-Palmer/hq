from __future__ import annotations

from datetime import datetime
from pathlib import PurePosixPath
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

Identifier = Annotated[str, Field(min_length=1, max_length=256)]
Coordinate = Annotated[
    int,
    Field(ge=0, le=2_147_483_647, json_schema_extra={"format": "int32"}),
]
Timestamp = Annotated[datetime, Field(json_schema_extra={"maxLength": 35})]
UuidValue = Annotated[UUID, Field(json_schema_extra={"maxLength": 36})]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Error(StrictModel):
    error: str = Field(min_length=1, max_length=4000)


class HealthResponse(StrictModel):
    status: Literal["ok"] = "ok"


class BundleProvenance(StrictModel):
    producer: str = Field(min_length=1, max_length=256)
    producer_version: str = Field(min_length=1, max_length=64)
    producer_revision: str = Field(min_length=64, max_length=64, pattern=r"^[a-f0-9]{64}$")
    dataset_id: str = Field(min_length=1, max_length=256)
    dataset_revision: str = Field(min_length=1, max_length=256)
    derivation: str = Field(min_length=1, max_length=2000)


class Asset(StrictModel):
    id: str = Field(
        min_length=1,
        max_length=256,
        pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._:-]*$",
    )
    kind: Literal["source", "proposal", "reference"]
    path: str = Field(min_length=1, max_length=4096)
    media_type: Literal["image/png", "image/jpeg", "image/webp"]
    sha256: str = Field(min_length=64, max_length=64, pattern=r"^[a-f0-9]{64}$")
    width: int = Field(ge=1, le=2_147_483_647, json_schema_extra={"format": "int32"})
    height: int = Field(ge=1, le=2_147_483_647, json_schema_extra={"format": "int32"})

    @model_validator(mode="after")
    def relative_safe_path(self) -> Asset:
        path = PurePosixPath(self.path)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("asset path must be a confined relative POSIX path")
        return self


class Proposal(StrictModel):
    id: str = Field(
        min_length=1,
        max_length=256,
        pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._:-]*$",
    )
    asset_id: Identifier
    role: Literal["primary", "alternative", "baseline"]
    model_name: str = Field(min_length=1, max_length=256)
    model_revision: str = Field(min_length=1, max_length=256)
    model_license: str = Field(min_length=1, max_length=128)
    source_box_clipped: bool


class ReviewContext(StrictModel):
    dataset_id: Identifier
    source_item_id: Identifier
    source_annotation_id: Identifier
    split: Literal["train", "validation"]
    site_id: Identifier
    class_name: Identifier
    bbox_xyxy: tuple[Coordinate, Coordinate, Coordinate, Coordinate] = Field(
        json_schema_extra={
            "items": {
                "type": "integer",
                "format": "int32",
                "minimum": 0,
                "maximum": 2_147_483_647,
            }
        }
    )
    coordinate_space: Identifier

    @model_validator(mode="after")
    def ordered_box(self) -> ReviewContext:
        xmin, ymin, xmax, ymax = self.bbox_xyxy
        if xmax < xmin or ymax < ymin:
            raise ValueError("bbox_xyxy must use ordered inclusive coordinates")
        return self


class ReviewItem(StrictModel):
    id: str = Field(
        min_length=1,
        max_length=256,
        pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._:-]*$",
    )
    source_asset_id: Identifier
    reference_asset_id: Identifier | None = None
    proposals: tuple[Proposal, ...] = Field(min_length=1, max_length=16)
    context: ReviewContext


class ReviewBundle(StrictModel):
    schema_version: Literal["1.0.0"]
    batch_id: str = Field(
        min_length=1,
        max_length=256,
        pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._:-]*$",
    )
    created_at: Timestamp
    provenance: BundleProvenance
    assets: tuple[Asset, ...] = Field(min_length=1, max_length=100_000)
    items: tuple[ReviewItem, ...] = Field(min_length=1, max_length=100_000)

    @model_validator(mode="after")
    def references_exist(self) -> ReviewBundle:
        asset_ids = [asset.id for asset in self.assets]
        if len(asset_ids) != len(set(asset_ids)):
            raise ValueError("asset ids must be unique")
        item_ids = [item.id for item in self.items]
        if len(item_ids) != len(set(item_ids)):
            raise ValueError("item ids must be unique")
        known_assets = set(asset_ids)
        proposal_ids: set[str] = set()
        for item in self.items:
            required = {item.source_asset_id}
            if item.reference_asset_id is not None:
                required.add(item.reference_asset_id)
            required.update(proposal.asset_id for proposal in item.proposals)
            missing = required - known_assets
            if missing:
                raise ValueError(f"item {item.id} references missing assets: {sorted(missing)}")
            for proposal in item.proposals:
                if proposal.id in proposal_ids:
                    raise ValueError("proposal ids must be unique across a bundle")
                proposal_ids.add(proposal.id)
        return self


class ReviewEvent(StrictModel):
    schema_version: Literal["1.0.0"]
    event_id: UuidValue
    batch_id: Identifier
    item_id: Identifier
    reviewer_id: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$",
    )
    reviewer_kind: Literal["human", "assistant"]
    created_at: Timestamp
    supersedes_event_id: UuidValue | None = None
    object_decision: Literal["valid_nucleus", "non_nucleus", "uncertain"]
    mask_decision: Literal["accept", "refine", "reject", "not_applicable"]
    selected_proposal_id: Identifier | None = None
    notes: str = Field(default="", max_length=4000)

    @model_validator(mode="after")
    def coherent_decisions(self) -> ReviewEvent:
        if self.object_decision != "valid_nucleus":
            if self.mask_decision != "not_applicable":
                raise ValueError("uncertain and non-nucleus objects cannot receive a mask decision")
            if self.selected_proposal_id is not None:
                raise ValueError("uncertain and non-nucleus objects cannot select a proposal")
        elif self.mask_decision == "not_applicable":
            raise ValueError("a valid nucleus requires a mask decision")
        if self.mask_decision in {"accept", "refine"} and self.selected_proposal_id is None:
            raise ValueError("accept and refine decisions require a selected proposal")
        if (
            self.mask_decision in {"reject", "not_applicable"}
            and self.selected_proposal_id is not None
        ):
            raise ValueError("reject and not-applicable decisions cannot select a proposal")
        return self


class ReviewSession(StrictModel):
    bundle: ReviewBundle
    latest_reviews: tuple[ReviewEvent, ...] = Field(max_length=100_000)
