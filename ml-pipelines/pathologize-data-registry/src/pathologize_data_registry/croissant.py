from __future__ import annotations

import json
import tempfile
from collections.abc import Sequence
from datetime import date
from pathlib import Path
from typing import Literal, cast

import mlcroissant as mlc
from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field

from pathologize_data_registry.models import SlideRecord
from pathologize_data_registry.repository import LoadedRegistry

CROISSANT_CONFORMS_TO = "http://mlcommons.org/croissant/1.1"
EXPORT_CONTRACT = "pathologize.data-registry-export/v1"
type JsonValue = str | int | float | bool | list[JsonValue] | dict[str, JsonValue] | None

CROISSANT_CONTEXT: dict[str, JsonValue] = {
    "@language": "en",
    "@vocab": "https://schema.org/",
    "arrayShape": "cr:arrayShape",
    "citeAs": "cr:citeAs",
    "column": "cr:column",
    "conformsTo": "dct:conformsTo",
    "containedIn": "cr:containedIn",
    "cr": "http://mlcommons.org/croissant/",
    "rai": "http://mlcommons.org/croissant/RAI/",
    "data": {"@id": "cr:data", "@type": "@json"},
    "dataType": {"@id": "cr:dataType", "@type": "@vocab"},
    "dct": "http://purl.org/dc/terms/",
    "description": {"@container": "@language"},
    "equivalentProperty": "cr:equivalentProperty",
    "examples": {"@id": "cr:examples", "@type": "@json"},
    "extract": "cr:extract",
    "field": "cr:field",
    "fileProperty": "cr:fileProperty",
    "fileObject": "cr:fileObject",
    "fileSet": "cr:fileSet",
    "format": "cr:format",
    "includes": "cr:includes",
    "isArray": "cr:isArray",
    "isLiveDataset": "cr:isLiveDataset",
    "jsonPath": "cr:jsonPath",
    "key": "cr:key",
    "md5": "cr:md5",
    "name": {"@container": "@language"},
    "parentField": "cr:parentField",
    "path": "cr:path",
    "recordSet": "cr:recordSet",
    "references": "cr:references",
    "regex": "cr:regex",
    "repeated": "cr:repeated",
    "replace": "cr:replace",
    "samplingRate": "cr:samplingRate",
    "sc": "https://schema.org/",
    "separator": "cr:separator",
    "source": "cr:source",
    "subField": "cr:subField",
    "transform": "cr:transform",
    "pathologize": "https://robbiepalmer.me/ns/pathologize#",
}


class CroissantValidationError(RuntimeError):
    pass


class ExportModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class CollectionExportRecord(ExportModel):
    collection_id: str
    title: str
    description: str
    registration_status: str
    publisher: str
    landing_page_url: AnyHttpUrl
    doi: str | None
    source_version: str
    retrieved_at: date
    license_name: str
    license_spdx_id: str
    license_url: AnyHttpUrl
    license_scope: str
    redistribution: str
    citation: str


class CollectionDocumentExportRecord(ExportModel):
    document_id: str
    collection_id: str
    role: Literal["landing_page", "documentation"]
    url: AnyHttpUrl


class LabelDomainExportRecord(ExportModel):
    label_domain_id: str
    collection_id: str
    source_native_label_domain: str


class SlideExportRecord(ExportModel):
    slide_id: str
    collection_id: str
    subset_id: str
    patient_id: str
    case_id: str
    specimen_id: str
    specimen_uid: str
    slide_container_id: str
    study_instance_uid: str
    series_instance_uid: str
    identity_basis: str
    scanner_manufacturer: str
    scanner_model: str
    scanner_serial_number: str | None
    objective_power: float
    conversion_note: str
    micrometres_per_pixel_x: float
    micrometres_per_pixel_y: float
    total_pixel_matrix_columns: int
    total_pixel_matrix_rows: int
    label_limitations: str


class SourceLabelExportRecord(ExportModel):
    label_id: str
    slide_id: str
    name: str
    value: str
    code: str | None
    coding_scheme: str | None
    coding_scheme_version: str | None
    provenance: str


class AssetExportRecord(ExportModel):
    asset_id: str
    subset_id: str
    slide_id: str
    relative_path: str
    sop_instance_uid: str
    image_role: str
    distribution_id: str


type ExportRecord = (
    CollectionExportRecord
    | CollectionDocumentExportRecord
    | LabelDomainExportRecord
    | SlideExportRecord
    | SourceLabelExportRecord
    | AssetExportRecord
)


class CroissantFieldDefinition(ExportModel):
    name: str
    data_type: str
    description: str


class CroissantReference(ExportModel):
    identifier: str = Field(alias="@id")


class CroissantField(ExportModel):
    field_type: Literal["cr:Field"] = Field(default="cr:Field", alias="@type")
    identifier: str = Field(alias="@id")
    name: str
    description: str
    data_type: str = Field(alias="dataType")


class CroissantFileObject(ExportModel):
    object_type: Literal["cr:FileObject"] = Field(default="cr:FileObject", alias="@type")
    identifier: str = Field(alias="@id")
    name: str
    description: str
    content_url: AnyHttpUrl = Field(alias="contentUrl")
    content_size: str = Field(alias="contentSize", pattern=r"^[1-9][0-9]* B$")
    encoding_format: Literal["application/dicom"] = Field(alias="encodingFormat")
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class CroissantRecordSet(ExportModel):
    record_set_type: Literal["cr:RecordSet"] = Field(default="cr:RecordSet", alias="@type")
    identifier: str = Field(alias="@id")
    name: str
    description: str
    key: CroissantReference
    fields: list[CroissantField] = Field(alias="field")
    data: list[dict[str, JsonValue]]


class CroissantExport(ExportModel):
    context: dict[str, JsonValue] = Field(alias="@context")
    dataset_type: Literal["sc:Dataset"] = Field(default="sc:Dataset", alias="@type")
    name: str
    description: str
    url: AnyHttpUrl
    conforms_to: Literal["http://mlcommons.org/croissant/1.1"] = Field(alias="conformsTo")
    cite_as: AnyHttpUrl = Field(alias="citeAs")
    date_published: date = Field(alias="datePublished")
    license: list[AnyHttpUrl]
    version: Literal["1.0.0"]
    contract: Literal["pathologize.data-registry-export/v1"] = Field(alias="pathologize:contract")
    registry_revision: str = Field(alias="pathologize:registryRevision", pattern=r"^[0-9a-f]{40}$")
    source_manifest: Literal["registry.json"] = Field(alias="pathologize:sourceManifest")
    distribution: list[CroissantFileObject]
    record_sets: list[CroissantRecordSet] = Field(alias="recordSet")


def _json_object(model: BaseModel) -> dict[str, JsonValue]:
    return cast(dict[str, JsonValue], model.model_dump(mode="json", by_alias=True))


def _field(record_set_id: str, definition: CroissantFieldDefinition) -> CroissantField:
    return CroissantField(
        identifier=f"{record_set_id}/{definition.name}",
        name=definition.name,
        description=definition.description,
        data_type=definition.data_type,
    )


def _field_definitions(
    *definitions: tuple[str, str, str],
) -> list[CroissantFieldDefinition]:
    return [
        CroissantFieldDefinition(name=name, data_type=data_type, description=description)
        for name, data_type, description in definitions
    ]


def _record_set(
    record_set_id: str,
    name: str,
    description: str,
    key: str,
    fields: list[CroissantFieldDefinition],
    data: Sequence[ExportRecord],
) -> CroissantRecordSet:
    return CroissantRecordSet(
        identifier=record_set_id,
        name=name,
        description=description,
        key=CroissantReference(identifier=f"{record_set_id}/{key}"),
        fields=[_field(record_set_id, definition) for definition in fields],
        data=[
            {
                f"{record_set_id}/{field_name}": value
                for field_name, value in _json_object(record).items()
            }
            for record in data
        ],
    )


def _collection_records(registry: LoadedRegistry) -> list[CollectionExportRecord]:
    return [
        CollectionExportRecord(
            collection_id=collection.collection_id,
            title=collection.title,
            description=collection.description,
            registration_status=collection.registration_status,
            publisher=collection.source.publisher,
            landing_page_url=collection.source.landing_page_url,
            doi=collection.source.doi,
            source_version=collection.source.source_version,
            retrieved_at=collection.source.retrieved_at,
            license_name=collection.license.name,
            license_spdx_id=collection.license.spdx_id,
            license_url=collection.license.url,
            license_scope=collection.license.scope,
            redistribution=collection.license.redistribution,
            citation=collection.citation,
        )
        for collection in registry.collections.values()
    ]


def _collection_document_records(
    registry: LoadedRegistry,
) -> list[CollectionDocumentExportRecord]:
    records: list[CollectionDocumentExportRecord] = []
    for collection in registry.collections.values():
        records.append(
            CollectionDocumentExportRecord(
                document_id=f"{collection.collection_id}/landing-page",
                collection_id=collection.collection_id,
                role="landing_page",
                url=collection.source.landing_page_url,
            )
        )
        records.extend(
            CollectionDocumentExportRecord(
                document_id=f"{collection.collection_id}/documentation/{index}",
                collection_id=collection.collection_id,
                role="documentation",
                url=url,
            )
            for index, url in enumerate(collection.source.documentation_urls)
        )
    return records


def _label_domain_records(registry: LoadedRegistry) -> list[LabelDomainExportRecord]:
    return [
        LabelDomainExportRecord(
            label_domain_id=f"{collection.collection_id}/{index}",
            collection_id=collection.collection_id,
            source_native_label_domain=domain,
        )
        for collection in registry.collections.values()
        for index, domain in enumerate(collection.source_native_label_domains)
    ]


def _slide_record(slide: SlideRecord) -> SlideExportRecord:
    return SlideExportRecord(
        slide_id=slide.slide_id,
        collection_id=slide.collection_id,
        subset_id=slide.subset_id,
        patient_id=slide.identity.patient_id,
        case_id=slide.identity.case_id,
        specimen_id=slide.identity.specimen_id,
        specimen_uid=slide.identity.specimen_uid,
        slide_container_id=slide.identity.slide_container_id,
        study_instance_uid=slide.identity.study_instance_uid,
        series_instance_uid=slide.identity.series_instance_uid,
        identity_basis=slide.identity.identity_basis,
        scanner_manufacturer=slide.scanner.manufacturer,
        scanner_model=slide.scanner.model,
        scanner_serial_number=slide.scanner.device_serial_number,
        objective_power=slide.scanner.objective_power,
        conversion_note=slide.scanner.conversion_note,
        micrometres_per_pixel_x=slide.physical_resolution.micrometres_per_pixel_x,
        micrometres_per_pixel_y=slide.physical_resolution.micrometres_per_pixel_y,
        total_pixel_matrix_columns=slide.physical_resolution.total_pixel_matrix_columns,
        total_pixel_matrix_rows=slide.physical_resolution.total_pixel_matrix_rows,
        label_limitations=slide.label_limitations,
    )


def _source_label_records(registry: LoadedRegistry) -> list[SourceLabelExportRecord]:
    return [
        SourceLabelExportRecord(
            label_id=f"{slide.slide_id}/{index}",
            slide_id=slide.slide_id,
            name=label.name,
            value=label.value,
            code=label.code,
            coding_scheme=label.coding_scheme,
            coding_scheme_version=label.coding_scheme_version,
            provenance=label.provenance,
        )
        for slide in registry.slides.values()
        for index, label in enumerate(slide.source_native_labels)
    ]


def _asset_records_and_distributions(
    registry: LoadedRegistry,
) -> tuple[list[AssetExportRecord], list[CroissantFileObject]]:
    records: list[AssetExportRecord] = []
    distributions: list[CroissantFileObject] = []
    slides_by_subset = {
        subset_id: {
            path: slide.slide_id
            for slide in registry.slides.values()
            if slide.subset_id == subset_id
            for path in slide.asset_paths
        }
        for subset_id in registry.subsets
    }
    for manifest in registry.asset_manifests.values():
        for asset in manifest.assets:
            distribution_id = f"assets/{manifest.asset_manifest_id}/{asset.relative_path}"
            records.append(
                AssetExportRecord(
                    asset_id=distribution_id,
                    subset_id=manifest.subset_id,
                    slide_id=slides_by_subset[manifest.subset_id][asset.relative_path],
                    relative_path=asset.relative_path,
                    sop_instance_uid=asset.sop_instance_uid,
                    image_role=asset.image_role,
                    distribution_id=distribution_id,
                )
            )
            distributions.append(
                CroissantFileObject(
                    identifier=distribution_id,
                    name=asset.relative_path,
                    description="Source pathology image object pinned by the registry.",
                    content_url=asset.source_url,
                    content_size=f"{asset.bytes} B",
                    encoding_format="application/dicom",
                    sha256=asset.sha256,
                )
            )
    return records, distributions


def build_croissant_export(registry: LoadedRegistry, registry_revision: str) -> CroissantExport:
    if len(registry_revision) != 40 or any(
        char not in "0123456789abcdef" for char in registry_revision
    ):
        raise ValueError("registry revision must be a 40-character lowercase Git SHA")
    asset_records, distributions = _asset_records_and_distributions(registry)
    record_sets = [
        _record_set(
            "collections",
            "Source collections",
            "Collection provenance, retrieval evidence, access terms, and licence scope.",
            "collection_id",
            _field_definitions(
                ("collection_id", "sc:Text", "Stable registry collection identifier."),
                ("title", "sc:Text", "Source collection title."),
                ("description", "sc:Text", "Source collection description."),
                ("registration_status", "sc:Text", "Registry acquisition status."),
                ("publisher", "sc:Text", "Source publisher."),
                ("landing_page_url", "sc:URL", "Source landing page."),
                ("doi", "sc:Text", "Source DOI when one exists."),
                ("source_version", "sc:Text", "Version reported by the source."),
                ("retrieved_at", "sc:Date", "Date the source evidence was retrieved."),
                ("license_name", "sc:Text", "Source licence name."),
                ("license_spdx_id", "sc:Text", "SPDX licence identifier."),
                ("license_url", "sc:URL", "Licence document URL."),
                ("license_scope", "sc:Text", "Evidence for the licence scope."),
                ("redistribution", "sc:Text", "Registry redistribution policy."),
                ("citation", "sc:Text", "Source citation."),
            ),
            _collection_records(registry),
        ),
        _record_set(
            "collection_documents",
            "Collection evidence documents",
            "Landing pages and documentation used to review each source collection.",
            "document_id",
            _field_definitions(
                ("document_id", "sc:Text", "Stable evidence document identifier."),
                ("collection_id", "sc:Text", "Owning registry collection."),
                ("role", "sc:Text", "Document role."),
                ("url", "sc:URL", "Evidence document URL."),
            ),
            _collection_document_records(registry),
        ),
        _record_set(
            "collection_label_domains",
            "Source-native label domains",
            "Label domains described by each source without a cross-dataset mapping.",
            "label_domain_id",
            _field_definitions(
                ("label_domain_id", "sc:Text", "Stable label-domain record identifier."),
                ("collection_id", "sc:Text", "Owning registry collection."),
                ("source_native_label_domain", "sc:Text", "Label domain named by the source."),
            ),
            _label_domain_records(registry),
        ),
        _record_set(
            "slides",
            "Source slides",
            "Stable source identities, scanner evidence, and physical scale for acquired slides.",
            "slide_id",
            _field_definitions(
                ("slide_id", "sc:Text", "Stable registry slide identifier."),
                ("collection_id", "sc:Text", "Owning registry collection."),
                ("subset_id", "sc:Text", "Owning acquired subset."),
                ("patient_id", "sc:Text", "Source patient identifier."),
                ("case_id", "sc:Text", "Source case identifier."),
                ("specimen_id", "sc:Text", "Source specimen identifier."),
                ("specimen_uid", "sc:Text", "DICOM specimen UID."),
                ("slide_container_id", "sc:Text", "Source slide container identifier."),
                ("study_instance_uid", "sc:Text", "DICOM Study Instance UID."),
                ("series_instance_uid", "sc:Text", "DICOM Series Instance UID."),
                ("identity_basis", "sc:Text", "Evidence used for the source identities."),
                ("scanner_manufacturer", "sc:Text", "Scanner manufacturer."),
                ("scanner_model", "sc:Text", "Scanner or conversion model."),
                ("scanner_serial_number", "sc:Text", "Scanner serial number when supplied."),
                ("objective_power", "sc:Float", "Objective lens power."),
                ("conversion_note", "sc:Text", "Source conversion note."),
                ("micrometres_per_pixel_x", "sc:Float", "Horizontal physical pixel size."),
                ("micrometres_per_pixel_y", "sc:Float", "Vertical physical pixel size."),
                ("total_pixel_matrix_columns", "sc:Integer", "Total source matrix width."),
                ("total_pixel_matrix_rows", "sc:Integer", "Total source matrix height."),
                ("label_limitations", "sc:Text", "Limits on source-native label interpretation."),
            ),
            [_slide_record(slide) for slide in registry.slides.values()],
        ),
        _record_set(
            "source_native_labels",
            "Source-native labels",
            "Labels and codes copied from the source without ontology harmonisation.",
            "label_id",
            _field_definitions(
                ("label_id", "sc:Text", "Stable label record identifier."),
                ("slide_id", "sc:Text", "Source slide identifier."),
                ("name", "sc:Text", "Source label field name."),
                ("value", "sc:Text", "Source label value."),
                ("code", "sc:Text", "Source terminology code when supplied."),
                ("coding_scheme", "sc:Text", "Source coding scheme when supplied."),
                ("coding_scheme_version", "sc:Text", "Source coding scheme version when supplied."),
                ("provenance", "sc:Text", "Source field or sequence that supplied the label."),
            ),
            _source_label_records(registry),
        ),
        _record_set(
            "assets",
            "Source assets",
            "DICOM source objects and their stable image identities.",
            "asset_id",
            _field_definitions(
                ("asset_id", "sc:Text", "Stable asset and Croissant distribution identifier."),
                ("subset_id", "sc:Text", "Owning acquired subset."),
                ("slide_id", "sc:Text", "Owning registry slide."),
                ("relative_path", "sc:Text", "Registry-relative source object path."),
                ("sop_instance_uid", "sc:Text", "DICOM SOP Instance UID."),
                ("image_role", "sc:Text", "DICOM image role."),
                ("distribution_id", "sc:Text", "Referenced Croissant FileObject identifier."),
            ),
            asset_records,
        ),
    ]
    return CroissantExport(
        context=CROISSANT_CONTEXT,
        name="Pathologize public data registry",
        description=registry.index.description,
        url="https://robbiepalmer.me/projects/pathologize",
        conforms_to=CROISSANT_CONFORMS_TO,
        cite_as="https://robbiepalmer.me/projects/pathologize",
        date_published=date(2026, 11, 6),
        license=sorted({item.license.url for item in registry.collections.values()}, key=str),
        version="1.0.0",
        contract=EXPORT_CONTRACT,
        registry_revision=registry_revision,
        source_manifest="registry.json",
        distribution=distributions,
        record_sets=record_sets,
    )


def croissant_json(payload: CroissantExport) -> str:
    return json.dumps(_json_object(payload), indent=2, sort_keys=True) + "\n"


def validate_croissant(payload: CroissantExport) -> None:
    with tempfile.TemporaryDirectory(prefix="pathologize-croissant-") as temp_dir:
        path = Path(temp_dir) / "registry.croissant.json"
        path.write_text(croissant_json(payload), encoding="utf-8")
        try:
            mlc.Dataset(str(path))
        except mlc.ValidationError as error:
            raise CroissantValidationError(str(error)) from error


def write_croissant_export(
    registry: LoadedRegistry,
    registry_revision: str,
    output_path: Path,
) -> Path:
    payload = build_croissant_export(registry, registry_revision)
    validate_croissant(payload)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(croissant_json(payload), encoding="utf-8")
    return output_path
