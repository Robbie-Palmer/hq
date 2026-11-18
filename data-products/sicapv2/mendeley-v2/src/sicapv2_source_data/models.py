from __future__ import annotations

from datetime import date
from typing import Annotated, Literal, Self

from pydantic import (
    AnyHttpUrl,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    RootModel,
    StrictBool,
    StrictInt,
    StrictStr,
    model_validator,
)

_ARTIFACT_REF_PATTERN = r"^sicapv2:v2:artifact:"
_PATIENT_REF_PATTERN = r"^sicapv2:v2:patient:"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PublisherModel(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)


class Contributor(StrictModel):
    profile_id: str = Field(min_length=1)
    name: Literal["Julio Silva-Rodríguez"]


class Institution(StrictModel):
    name: Literal["Universitat Politecnica de Valencia"]
    ror_id: AnyHttpUrl


class License(StrictModel):
    spdx_id: Literal["CC-BY-4.0"]
    name: Literal["Creative Commons Attribution 4.0 International"]
    url: AnyHttpUrl
    attribution: str = Field(min_length=1)


class Archive(StrictModel):
    file_id: Literal["6ab087a7-ca89-47ac-9698-f6546bb50f98"]
    filename: Literal["SICAPv2.zip"]
    url: AnyHttpUrl
    content_type: Literal["application/x-zip-compressed"]
    bytes: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    created_at: str = Field(min_length=1)


class PhysicalScale(StrictModel):
    source_magnification: Literal["40X"]
    patch_magnification: Literal["10X"]
    downsample_factor: Literal[4]
    patch_width_pixels: Literal[512]
    patch_height_pixels: Literal[512]
    overlap_fraction: float = Field(ge=0.5, le=0.5)
    minimum_tissue_fraction: float = Field(ge=0.2, le=0.2)
    coordinate_frame: Literal["publisher_wsi"]
    coordinate_unit: Literal["source_pixel"]


class NativeMaskLabel(StrictModel):
    id: int = Field(ge=0, le=3)
    name: Literal["NC", "GG3", "GG4", "GG5"]
    description: str = Field(min_length=1)


class PublishedPartition(StrictModel):
    id: Literal["test", "validation_val1", "validation_val2", "validation_val3", "validation_val4"]
    path: str = Field(pattern=r"^SICAPv2/partition/")


class ExpectedPatchLabelCounts(StrictModel):
    NC: int = Field(ge=0)
    G3: int = Field(ge=0)
    G4: int = Field(ge=0)
    G5: int = Field(ge=0)
    G4C: int = Field(ge=0)


class ExpectedCounts(StrictModel):
    patient_count: int = Field(gt=0)
    slide_count: int = Field(gt=0)
    patch_count: int = Field(gt=0)
    image_count: int = Field(gt=0)
    mask_count: int = Field(gt=0)
    archive_member_count: int = Field(gt=0)
    published_labelled_patch_count: int = Field(gt=0)
    published_patch_label_counts: ExpectedPatchLabelCounts


class SourceManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["sicapv2-mendeley-v2"]
    title: str = Field(min_length=1)
    doi: Literal["10.17632/9xxm58dvs3.2"]
    paper_doi: Literal["10.1016/j.cmpb.2020.105637"]
    publisher: Literal["Mendeley Data"]
    publisher_record: AnyHttpUrl
    publisher_dataset_id: Literal["9xxm58dvs3"]
    publisher_version: Literal[2]
    published_at: Literal["2020-10-22T13:41:01.412Z"]
    source_release: Literal["Version 1: 2020-05"]
    contributor: Contributor
    institution: Institution
    license: License
    archive: Archive
    scale: PhysicalScale
    native_mask_labels: list[NativeMaskLabel]
    published_patch_labels: list[Literal["NC", "G3", "G4", "G5", "G4C"]]
    published_partitions: list[PublishedPartition]
    expected: ExpectedCounts

    @model_validator(mode="after")
    def preserve_complete_native_contract(self) -> Self:
        if [(label.id, label.name) for label in self.native_mask_labels] != [
            (0, "NC"),
            (1, "GG3"),
            (2, "GG4"),
            (3, "GG5"),
        ]:
            raise ValueError("SICAPv2 mask labels must preserve publisher values 0 through 3")
        if self.published_patch_labels != ["NC", "G3", "G4", "G5", "G4C"]:
            raise ValueError("SICAPv2 patch labels must preserve publisher column order")
        if len({partition.id for partition in self.published_partitions}) != 5:
            raise ValueError("SICAPv2 must preserve the test partition and four validation folds")
        return self


class MendeleyDoi(PublisherModel):
    id: StrictStr = Field(min_length=1)


class MendeleyLicense(PublisherModel):
    short_name: StrictStr = Field(min_length=1)
    full_name: StrictStr = Field(min_length=1)


class MendeleyContributor(PublisherModel):
    profile_id: StrictStr = Field(min_length=1)
    first_name: StrictStr = Field(min_length=1)
    last_name: StrictStr = Field(min_length=1)

    @property
    def name(self) -> str:
        return f"{self.first_name} {self.last_name}"


class MendeleyDataset(PublisherModel):
    id: StrictStr = Field(min_length=1)
    doi: MendeleyDoi
    version: StrictInt = Field(gt=0)
    name: StrictStr = Field(min_length=1)
    publish_date: StrictStr = Field(pattern=r"^\d{4}-\d{2}-\d{2}")
    data_licence: MendeleyLicense
    contributors: list[MendeleyContributor]


class MendeleyFileContent(PublisherModel):
    sha256_hash: StrictStr = Field(pattern=r"^[a-f0-9]{64}$")
    content_type: StrictStr = Field(min_length=1)


class MendeleyFile(PublisherModel):
    id: StrictStr = Field(min_length=1)
    filename: StrictStr = Field(min_length=1)
    size: StrictInt = Field(gt=0)
    content_details: MendeleyFileContent


class MendeleyVersion(PublisherModel):
    version: StrictInt = Field(gt=0)
    publish_date: StrictStr = Field(pattern=r"^\d{4}-\d{2}-\d{2}")
    available: StrictBool

    @property
    def published_on(self) -> date:
        return date.fromisoformat(self.publish_date[:10])


class MendeleyMetadataResponse(StrictModel):
    dataset: MendeleyDataset
    files: list[MendeleyFile]
    versions: list[MendeleyVersion]

    @model_validator(mode="after")
    def require_single_pinned_release(self) -> Self:
        if len(self.dataset.contributors) != 1:
            raise ValueError("Mendeley metadata must contain exactly one contributor")
        if len(self.files) != 1:
            raise ValueError("Mendeley metadata must contain exactly one root file")
        matching_versions = [
            version for version in self.versions if version.version == self.dataset.version
        ]
        if len(matching_versions) != 1:
            raise ValueError("Mendeley version history must contain the dataset version once")
        version = matching_versions[0]
        if not version.available:
            raise ValueError("Mendeley dataset version must be available")
        if version.published_on != date.fromisoformat(self.dataset.publish_date[:10]):
            raise ValueError("Mendeley version and dataset publication dates must agree")
        return self

    @property
    def version(self) -> MendeleyVersion:
        return next(version for version in self.versions if version.version == self.dataset.version)


class PublisherArchiveMetadata(StrictModel):
    file_id: str = Field(min_length=1)
    filename: str = Field(min_length=1)
    bytes: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    content_type: str = Field(min_length=1)


class PublisherMetadataContract(StrictModel):
    publisher_dataset_id: str = Field(min_length=1)
    doi: str = Field(min_length=1)
    publisher_version: int = Field(gt=0)
    title: str = Field(min_length=1)
    published_at: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}")
    license_short_name: str = Field(min_length=1)
    license_name: str = Field(min_length=1)
    contributor_profile_id: str = Field(min_length=1)
    contributor_name: str = Field(min_length=1)
    archive: PublisherArchiveMetadata
    version_published_on: date
    version_available: bool

    @classmethod
    def from_manifest(cls, manifest: SourceManifest) -> Self:
        return cls(
            publisher_dataset_id=manifest.publisher_dataset_id,
            doi=manifest.doi,
            publisher_version=manifest.publisher_version,
            title=manifest.title,
            published_at=manifest.published_at,
            license_short_name="CC BY 4.0",
            license_name=manifest.license.name,
            contributor_profile_id=manifest.contributor.profile_id,
            contributor_name=manifest.contributor.name,
            archive=PublisherArchiveMetadata(
                file_id=manifest.archive.file_id,
                filename=manifest.archive.filename,
                bytes=manifest.archive.bytes,
                sha256=manifest.archive.sha256,
                content_type=manifest.archive.content_type,
            ),
            version_published_on=date.fromisoformat(manifest.published_at[:10]),
            version_available=True,
        )

    @classmethod
    def from_response(cls, response: MendeleyMetadataResponse) -> Self:
        dataset = response.dataset
        contributor = dataset.contributors[0]
        archive = response.files[0]
        return cls(
            publisher_dataset_id=dataset.id,
            doi=dataset.doi.id,
            publisher_version=dataset.version,
            title=dataset.name,
            published_at=dataset.publish_date,
            license_short_name=dataset.data_licence.short_name,
            license_name=dataset.data_licence.full_name,
            contributor_profile_id=contributor.profile_id,
            contributor_name=contributor.name,
            archive=PublisherArchiveMetadata(
                file_id=archive.id,
                filename=archive.filename,
                bytes=archive.size,
                sha256=archive.content_details.sha256_hash,
                content_type=archive.content_details.content_type,
            ),
            version_published_on=response.version.published_on,
            version_available=response.version.available,
        )


class PublisherMetadataEvidence(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    verification_scope: Literal["publisher_metadata_only"] = "publisher_metadata_only"
    credentials_required: Literal[False] = False
    archive_bytes_downloaded: Literal[False] = False
    dataset_id: Literal["sicapv2-mendeley-v2"]
    publisher_dataset_id: str = Field(min_length=1)
    publisher_version: int = Field(gt=0)
    doi: str = Field(min_length=1)
    license: Literal["CC-BY-4.0"]
    contributor_profile_id: str = Field(min_length=1)
    archive: PublisherArchiveMetadata
    verified: Literal[True] = True

    @classmethod
    def from_verified_contract(
        cls, contract: PublisherMetadataContract, manifest: SourceManifest
    ) -> Self:
        return cls(
            dataset_id=manifest.dataset_id,
            publisher_dataset_id=contract.publisher_dataset_id,
            publisher_version=contract.publisher_version,
            doi=contract.doi,
            license=manifest.license.spdx_id,
            contributor_profile_id=contract.contributor_profile_id,
            archive=contract.archive,
        )


class OriginalArtifact(StrictModel):
    artifact_ref: str = Field(pattern=_ARTIFACT_REF_PATTERN)
    archive_ref: Literal["mendeley:9xxm58dvs3:v2:file:6ab087a7-ca89-47ac-9698-f6546bb50f98"]
    member_path: str = Field(pattern=r"^SICAPv2/")
    bytes: int = Field(ge=0)
    crc32: str = Field(pattern=r"^[a-f0-9]{8}$")
    media_type: str = Field(min_length=1)


class PublishedRole(StrictModel):
    partition_id: Literal[
        "test", "validation_val1", "validation_val2", "validation_val3", "validation_val4"
    ]
    task: Literal["gleason_grading", "cribriform_detection"]
    role: Literal["train", "test"]
    table_artifact_ref: str = Field(pattern=_ARTIFACT_REF_PATTERN)


class PublishedPatchLabels(StrictModel):
    NC: int = Field(ge=0, le=1)
    G3: int = Field(ge=0, le=1)
    G4: int = Field(ge=0, le=1)
    G5: int = Field(ge=0, le=1)
    G4C: int = Field(ge=0, le=1)


def _validate_excel_integer(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int | float) or int(value) != value:
        raise ValueError("value must be an integer")
    return int(value)


ExcelInteger = Annotated[int, BeforeValidator(_validate_excel_integer)]


class SlideTableRow(StrictModel):
    slide_id: str = Field(min_length=1)
    patient_id: StrictStr | StrictInt
    gleason_primary: ExcelInteger = Field(alias="Gleason_primary", ge=0, le=5)
    gleason_secondary: ExcelInteger = Field(alias="Gleason_secondary", ge=0, le=5)

    @property
    def patient_identity(self) -> str:
        return str(self.patient_id)


class PublishedPatchTableRow(StrictModel):
    image_name: str = Field(min_length=1)
    NC: ExcelInteger = Field(ge=0, le=1)
    G3: ExcelInteger = Field(ge=0, le=1)
    G4: ExcelInteger = Field(ge=0, le=1)
    G5: ExcelInteger = Field(ge=0, le=1)
    G4C: ExcelInteger = Field(ge=0, le=1)

    def labels(self) -> PublishedPatchLabels:
        return PublishedPatchLabels.model_validate(self, from_attributes=True)


class CribriformTableRow(StrictModel):
    image_name: str = Field(min_length=1)
    G4C: ExcelInteger = Field(ge=0, le=1)


class PatchCoordinates(StrictModel):
    region: int = Field(ge=0)
    row: int = Field(ge=0)
    column: int = Field(ge=0)
    xini: int = Field(ge=0)
    yini: int = Field(ge=0)
    coordinate_frame: Literal["publisher_wsi"] = "publisher_wsi"
    coordinate_unit: Literal["source_pixel"] = "source_pixel"


class PatientRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: Literal["sicapv2-mendeley-v2"] = "sicapv2-mendeley-v2"
    record_ref: str = Field(pattern=_PATIENT_REF_PATTERN)
    patient_id: str = Field(min_length=1)
    slide_refs: list[str] = Field(min_length=1)


class SlideRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: Literal["sicapv2-mendeley-v2"] = "sicapv2-mendeley-v2"
    record_ref: str = Field(pattern=r"^sicapv2:v2:slide:")
    slide_id: str = Field(min_length=1)
    patient_ref: str = Field(pattern=_PATIENT_REF_PATTERN)
    patient_id: str = Field(min_length=1)
    gleason_primary: int = Field(ge=0, le=5)
    gleason_secondary: int = Field(ge=0, le=5)
    global_gleason_score: str = Field(pattern=r"^(NC|[345]\+[345]=[6-9]|5\+5=10)$")
    grade_group: int = Field(ge=0, le=5)
    grade_group_provenance: Literal["lossless_isup_mapping_from_published_primary_secondary"]
    source_table_artifact_ref: str = Field(pattern=_ARTIFACT_REF_PATTERN)
    patch_refs: list[str]


class PatchRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: Literal["sicapv2-mendeley-v2"] = "sicapv2-mendeley-v2"
    record_ref: str = Field(pattern=r"^sicapv2:v2:patch:")
    patch_id: str = Field(min_length=1)
    slide_ref: str = Field(pattern=r"^sicapv2:v2:slide:")
    slide_id: str = Field(min_length=1)
    patient_ref: str = Field(pattern=_PATIENT_REF_PATTERN)
    coordinates: PatchCoordinates
    scale: PhysicalScale
    image: OriginalArtifact
    gleason_pattern_mask: OriginalArtifact
    mask_label_ids: tuple[Literal[0], Literal[1], Literal[2], Literal[3]]
    published_labels: PublishedPatchLabels | None
    published_roles: list[PublishedRole]


Count = Annotated[int, Field(ge=0)]
PublishedRoleCountKey = Annotated[
    str,
    Field(
        pattern=(
            r"^(test|validation_val[1-4]):"
            r"(gleason_grading|cribriform_detection):(train|test)$"
        )
    ),
]
GlobalGleasonScoreCountKey = Annotated[str, Field(pattern=r"^(NC|[345]\+[345]=[6-9]|5\+5=10)$")]
GradeGroupCountKey = Literal["0", "1", "2", "3", "4", "5"]


class PublishedRoleCounts(RootModel[dict[PublishedRoleCountKey, Count]]):
    model_config = ConfigDict(frozen=True)


class GlobalGleasonScoreCounts(RootModel[dict[GlobalGleasonScoreCountKey, Count]]):
    model_config = ConfigDict(frozen=True)


class GradeGroupCounts(RootModel[dict[GradeGroupCountKey, Count]]):
    model_config = ConfigDict(frozen=True)


class SourceMetrics(StrictModel):
    dataset_id: Literal["sicapv2-mendeley-v2"]
    patient_count: int = Field(gt=0)
    slide_count: int = Field(gt=0)
    patch_count: int = Field(gt=0)
    paired_mask_count: int = Field(gt=0)
    published_labelled_patch_count: int = Field(gt=0)
    published_patch_label_counts: ExpectedPatchLabelCounts
    published_role_counts: PublishedRoleCounts
    global_gleason_score_counts: GlobalGleasonScoreCounts
    grade_group_counts: GradeGroupCounts


class RecordSets(StrictModel):
    patients: Literal["outputs/patients.jsonl"] = "outputs/patients.jsonl"
    slides: Literal["outputs/slides.jsonl"] = "outputs/slides.jsonl"
    patches: Literal["outputs/patches.jsonl"] = "outputs/patches.jsonl"


class SourceCatalog(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    dataset_id: Literal["sicapv2-mendeley-v2"]
    dataset_ref: Literal["sicapv2:v2:dataset:10.17632/9xxm58dvs3.2"]
    archive_ref: Literal["mendeley:9xxm58dvs3:v2:file:6ab087a7-ca89-47ac-9698-f6546bb50f98"]
    archive_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    source_release: Literal["Version 1: 2020-05"]
    rights: License
    native_mask_labels: list[NativeMaskLabel]
    record_sets: RecordSets
    table_artifacts: list[OriginalArtifact]
