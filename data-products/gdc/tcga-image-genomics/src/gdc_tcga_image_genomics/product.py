from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, cast

from gdc_tcga_image_genomics.models import (
    ApiPage,
    ArtifactReference,
    AssociatedEntity,
    BiospecimenChain,
    GdcFile,
    NativeRecord,
    PartitionAssignment,
    QueryContract,
    QuerySpec,
    ReleaseContract,
)

PROJECT_DIR = Path(__file__).resolve().parents[2]


class ProductError(RuntimeError):
    pass


def _read_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ProductError(f"{path} must contain a JSON object")
    return cast(dict[str, Any], payload)


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _write_jsonl(path: Path, values: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(value, sort_keys=True) + "\n" for value in values),
        encoding="utf-8",
    )


def load_contracts(root: Path = PROJECT_DIR) -> tuple[ReleaseContract, QueryContract]:
    release = ReleaseContract.model_validate(_read_object(root / "contracts/release.json"))
    queries = QueryContract.model_validate(_read_object(root / "contracts/queries.json"))
    if queries.dataset_id != release.dataset_id:
        raise ProductError("release and query contracts have different dataset IDs")
    return release, queries


def validate_status(status: dict[str, Any], release: ReleaseContract) -> None:
    version = status.get("data_release_version")
    if not isinstance(version, dict):
        raise ProductError("GDC status has no data_release_version object")
    actual = f"{version.get('major')}.{version.get('minor')}"
    if actual != release.data_release or version.get("release_date") != release.release_date:
        raise ProductError(
            f"GDC status reports release {actual} on {version.get('release_date')}, "
            f"expected {release.data_release} on {release.release_date}"
        )
    if status.get("status") != "OK":
        raise ProductError("GDC status is not OK")


def _as_dict(value: object, description: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ProductError(f"{description} must be an object")
    return cast(dict[str, Any], value)


def _items(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [cast(dict[str, Any], item) for item in value if isinstance(item, dict)]


def _value(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _find(items: list[dict[str, Any]], key: str, expected: str) -> dict[str, Any] | None:
    return next((item for item in items if item.get(key) == expected), None)


def _case_for(file: GdcFile, case_id: str) -> dict[str, Any]:
    case = _find(file.cases, "case_id", case_id)
    if case is None:
        raise ProductError(f"{file.file_id}: associated case {case_id} is absent")
    return case


def _locate_chain(file: GdcFile, entity: AssociatedEntity) -> BiospecimenChain:  # noqa: C901
    case = _case_for(file, entity.case_id)
    case_submitter_id = _value(case.get("submitter_id"))
    project_id = _value(_as_dict(case.get("project"), "case project").get("project_id"))
    if case_submitter_id is None or project_id is None:
        raise ProductError(f"{file.file_id}: case identity is incomplete")

    found_sample: dict[str, Any] | None = None
    found_portion: dict[str, Any] | None = None
    found_slide: dict[str, Any] | None = None
    found_analyte: dict[str, Any] | None = None
    found_aliquot: dict[str, Any] | None = None
    if entity.entity_type != "case":
        for sample in _items(case.get("samples")):
            if entity.entity_type == "sample" and sample.get("sample_id") == entity.entity_id:
                found_sample = sample
                break
            for portion in _items(sample.get("portions")):
                if (
                    entity.entity_type == "portion"
                    and portion.get("portion_id") == entity.entity_id
                ):
                    found_sample, found_portion = sample, portion
                    break
                slide = _find(_items(portion.get("slides")), "slide_id", entity.entity_id)
                if entity.entity_type == "slide" and slide is not None:
                    found_sample, found_portion, found_slide = sample, portion, slide
                    break
                for analyte in _items(portion.get("analytes")):
                    if (
                        entity.entity_type == "analyte"
                        and analyte.get("analyte_id") == entity.entity_id
                    ):
                        found_sample, found_portion, found_analyte = sample, portion, analyte
                        break
                    aliquot = _find(_items(analyte.get("aliquots")), "aliquot_id", entity.entity_id)
                    if entity.entity_type == "aliquot" and aliquot is not None:
                        found_sample, found_portion = sample, portion
                        found_analyte, found_aliquot = analyte, aliquot
                        break
                if found_sample is not None:
                    break
            if found_sample is not None:
                break
        if found_sample is None:
            raise ProductError(
                f"{file.file_id}: associated {entity.entity_type} {entity.entity_id} "
                "is absent from the expanded biospecimen tree"
            )

    return BiospecimenChain(
        case_id=entity.case_id,
        case_submitter_id=case_submitter_id,
        participant_submitter_id=case_submitter_id,
        project_id=project_id,
        associated_entity_type=entity.entity_type,
        associated_entity_id=entity.entity_id,
        associated_entity_submitter_id=entity.entity_submitter_id,
        sample_id=_value((found_sample or {}).get("sample_id")),
        sample_submitter_id=_value((found_sample or {}).get("submitter_id")),
        sample_type=_value((found_sample or {}).get("sample_type")),
        specimen_type=_value((found_sample or {}).get("specimen_type")),
        tissue_type=_value((found_sample or {}).get("tissue_type")),
        tumor_descriptor=_value((found_sample or {}).get("tumor_descriptor")),
        portion_id=_value((found_portion or {}).get("portion_id")),
        portion_submitter_id=_value((found_portion or {}).get("submitter_id")),
        portion_number=_value((found_portion or {}).get("portion_number")),
        portion_is_ffpe=(found_portion or {}).get("is_ffpe"),
        slide_id=_value((found_slide or {}).get("slide_id")),
        slide_submitter_id=_value((found_slide or {}).get("submitter_id")),
        slide_section_location=_value((found_slide or {}).get("section_location")),
        analyte_id=_value((found_analyte or {}).get("analyte_id")),
        analyte_submitter_id=_value((found_analyte or {}).get("submitter_id")),
        analyte_type=_value((found_analyte or {}).get("analyte_type")),
        analyte_experimental_protocol_type=_value(
            (found_analyte or {}).get("experimental_protocol_type")
        ),
        aliquot_id=_value((found_aliquot or {}).get("aliquot_id")),
        aliquot_submitter_id=_value((found_aliquot or {}).get("submitter_id")),
    )


def _read_query_files(source_root: Path, query: QuerySpec) -> list[GdcFile]:
    pages = sorted((source_root / query.query_id).glob("page-*.json"))
    if not pages:
        raise ProductError(f"no metadata pages found for {query.query_id}")
    files: list[GdcFile] = []
    expected_from = 0
    reported_total: int | None = None
    for path in pages:
        page = ApiPage.model_validate(_read_object(path))
        pagination = page.data.pagination
        if pagination.from_ != expected_from or pagination.count != len(page.data.hits):
            raise ProductError(f"{path}: pagination is not contiguous")
        if reported_total is None:
            reported_total = pagination.total
        elif reported_total != pagination.total:
            raise ProductError(f"{path}: query total changed between pages")
        expected_from += pagination.count
        files.extend(page.data.hits)
    if expected_from != reported_total:
        raise ProductError(
            f"{query.query_id}: pages contain {expected_from} of {reported_total} records"
        )
    return files


def _validate_source_file(file: GdcFile, query: QuerySpec) -> None:
    if file.access != "open":
        raise ProductError(f"{file.file_id}: controlled file entered the open product")
    if query.record_kind == "diagnostic_slide":
        if file.data_type != "Slide Image" or file.experimental_strategy != "Diagnostic Slide":
            raise ProductError(f"{file.file_id}: record is not a GDC diagnostic slide")
    elif file.data_type == "Slide Image":
        raise ProductError(f"{file.file_id}: slide entered the molecular record set")


def _artifact(file: GdcFile, release: ReleaseContract) -> ArtifactReference:
    analysis = file.analysis or {}
    return ArtifactReference(
        dataset_id=release.dataset_id,
        artifact_id=file.file_id,
        native_record_id=f"gdc:file:{file.file_id}",
        file_name=file.file_name,
        source_url=f"{str(release.api_base_url).rstrip('/')}/data/{file.file_id}",
        bytes=file.file_size,
        md5=file.md5sum,
        access=file.access,
        data_category=file.data_category,
        data_type=file.data_type,
        data_format=file.data_format,
        experimental_strategy=file.experimental_strategy,
        workflow_type=_value(analysis.get("workflow_type")),
    )


def _annotations(value: object, found: dict[str, dict[str, Any]]) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "annotations":
                for annotation in _items(child):
                    annotation_id = _value(annotation.get("annotation_id"))
                    if annotation_id is None:
                        raise ProductError("GDC annotation has no annotation_id")
                    previous = found.setdefault(annotation_id, annotation)
                    if previous != annotation:
                        raise ProductError(
                            f"GDC annotation {annotation_id} differs between records"
                        )
            _annotations(child, found)
    elif isinstance(value, list):
        for child in value:
            _annotations(child, found)


def _case_outputs(records: list[NativeRecord]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    case_records: dict[str, dict[str, Any]] = {}
    for record in records:
        for chain in record.biospecimen_chains:
            entry = case_records.setdefault(
                chain.case_id,
                {
                    "schema_version": "1.0.0",
                    "dataset_id": record.dataset_id,
                    "case_id": chain.case_id,
                    "case_submitter_id": chain.case_submitter_id,
                    "participant_submitter_id": chain.participant_submitter_id,
                    "project_ids": set(),
                    "diagnostic_slide_record_ids": set(),
                    "molecular_evidence_record_ids": set(),
                    "sample_ids": set(),
                    "portion_ids": set(),
                    "slide_ids": set(),
                    "analyte_ids": set(),
                    "aliquot_ids": set(),
                },
            )
            if entry["case_submitter_id"] != chain.case_submitter_id:
                raise ProductError(f"case {chain.case_id} has inconsistent submitter IDs")
            entry["project_ids"].add(chain.project_id)
            entry[f"{record.record_kind}_record_ids"].add(record.record_id)
            for key, value in (
                ("sample_ids", chain.sample_id),
                ("portion_ids", chain.portion_id),
                ("slide_ids", chain.slide_id),
                ("analyte_ids", chain.analyte_id),
                ("aliquot_ids", chain.aliquot_id),
            ):
                if value is not None:
                    entry[key].add(value)
    links = []
    groups = []
    for case_id, entry in sorted(case_records.items()):
        links.append(
            {
                key: sorted(value) if isinstance(value, set) else value
                for key, value in entry.items()
            }
        )
        groups.append(
            {
                "schema_version": "1.0.0",
                "dataset_id": entry["dataset_id"],
                "leakage_unit": "gdc_case",
                "leakage_group_id": case_id,
                "case_id": case_id,
                "case_submitter_id": entry["case_submitter_id"],
                "participant_submitter_id": entry["participant_submitter_id"],
                "record_ids": sorted(
                    entry["diagnostic_slide_record_ids"] | entry["molecular_evidence_record_ids"]
                ),
            }
        )
    return links, groups


def _missingness(records: list[NativeRecord]) -> list[dict[str, Any]]:  # noqa: C901
    observed: dict[tuple[str, str], list[bool]] = defaultdict(list)
    for record in records:
        source = record.source
        if record.record_kind == "diagnostic_slide":
            observed[(record.record_kind, "file.stain_type")].append(
                _value(source.get("stain_type")) is not None
            )
        else:
            analysis = source.get("analysis")
            analysis_dict = analysis if isinstance(analysis, dict) else {}
            for field in ("workflow_type", "workflow_link", "workflow_version"):
                observed[(record.record_kind, f"analysis.{field}")].append(
                    _value(analysis_dict.get(field)) is not None
                )
        for chain in record.biospecimen_chains:
            values = chain.model_dump(mode="python")
            field_names = [
                "case_id",
                "case_submitter_id",
                "participant_submitter_id",
                "project_id",
            ]
            if chain.associated_entity_type != "case":
                field_names.extend(
                    ["sample_id", "sample_submitter_id", "sample_type", "specimen_type"]
                )
            if chain.associated_entity_type in {"portion", "slide", "analyte", "aliquot"}:
                field_names.extend(
                    ["portion_id", "portion_submitter_id", "portion_number", "portion_is_ffpe"]
                )
            if chain.associated_entity_type == "slide":
                field_names.extend(["slide_id", "slide_submitter_id", "slide_section_location"])
            if chain.associated_entity_type in {"analyte", "aliquot"}:
                field_names.extend(
                    [
                        "analyte_id",
                        "analyte_submitter_id",
                        "analyte_type",
                        "analyte_experimental_protocol_type",
                    ]
                )
            if chain.associated_entity_type == "aliquot":
                field_names.extend(["aliquot_id", "aliquot_submitter_id"])
            for field in field_names:
                observed[(record.record_kind, f"biospecimen_chain.{field}")].append(
                    values[field] is not None
                )
    return [
        {
            "record_kind": kind,
            "field": field,
            "applicable_count": len(values),
            "present_count": sum(values),
            "missing_count": len(values) - sum(values),
            "missing_semantics": "absent_or_null_in_gdc_api",
        }
        for (kind, field), values in sorted(observed.items())
    ]


def validate_partitions(
    records: list[NativeRecord], assignments: list[PartitionAssignment]
) -> None:
    record_groups = {
        record.record_id: (
            {chain.case_id for chain in record.biospecimen_chains},
            {chain.participant_submitter_id for chain in record.biospecimen_chains},
        )
        for record in records
    }
    assigned: dict[str, str] = {}
    case_partitions: dict[str, set[str]] = defaultdict(set)
    participant_partitions: dict[str, set[str]] = defaultdict(set)
    for assignment in assignments:
        if assignment.record_id not in record_groups:
            raise ProductError(f"unknown record in partition assignment: {assignment.record_id}")
        previous = assigned.setdefault(assignment.record_id, assignment.partition)
        if previous != assignment.partition:
            raise ProductError(f"record has multiple partitions: {assignment.record_id}")
        cases, participants = record_groups[assignment.record_id]
        for case_id in cases:
            case_partitions[case_id].add(assignment.partition)
        for participant_id in participants:
            participant_partitions[participant_id].add(assignment.partition)
    leaked_cases = sorted(
        case_id for case_id, partitions in case_partitions.items() if len(partitions) > 1
    )
    leaked_participants = sorted(
        participant_id
        for participant_id, partitions in participant_partitions.items()
        if len(partitions) > 1
    )
    if leaked_cases or leaked_participants:
        raise ProductError(
            "patient-level leakage across partitions: "
            f"cases={leaked_cases}, participants={leaked_participants}"
        )


def load_native_records(path: Path) -> list[NativeRecord]:
    return [
        NativeRecord.model_validate_json(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]


def publish_product(
    source_root: Path,
    output_root: Path,
    *,
    root: Path = PROJECT_DIR,
) -> dict[str, object]:
    release, query_contract = load_contracts(root)
    validate_status(_read_object(source_root / "status.json"), release)
    records: list[NativeRecord] = []
    artifacts: list[ArtifactReference] = []
    annotations: dict[str, dict[str, Any]] = {}
    seen_files: set[str] = set()
    for query in query_contract.queries:
        for file in _read_query_files(source_root, query):
            if file.file_id in seen_files:
                raise ProductError(f"duplicate GDC file across queries: {file.file_id}")
            seen_files.add(file.file_id)
            _validate_source_file(file, query)
            chains = [_locate_chain(file, entity) for entity in file.associated_entities]
            source = file.model_dump(mode="json", exclude_none=False)
            records.append(
                NativeRecord(
                    dataset_id=release.dataset_id,
                    record_id=f"gdc:file:{file.file_id}",
                    record_kind=query.record_kind,
                    biospecimen_chains=chains,
                    source=source,
                )
            )
            artifacts.append(_artifact(file, release))
            _annotations(source, annotations)

    records.sort(key=lambda item: item.record_id)
    artifacts.sort(key=lambda item: item.artifact_id)
    links, groups = _case_outputs(records)
    missingness = _missingness(records)
    validate_partitions(
        records,
        [PartitionAssignment(record_id=record.record_id, partition="source") for record in records],
    )
    record_counts = Counter(record.record_kind for record in records)
    workflow_counts = Counter(
        artifact.workflow_type or "missing"
        for artifact in artifacts
        if artifact.data_type != "Slide Image"
    )
    metrics: dict[str, object] = {
        "dataset_id": release.dataset_id,
        "record_count": len(records),
        "records_by_kind": dict(sorted(record_counts.items())),
        "artifact_count": len(artifacts),
        "annotation_count": len(annotations),
        "case_count": len(groups),
        "participant_count": len({group["participant_submitter_id"] for group in groups}),
        "open_artifact_count": sum(artifact.access == "open" for artifact in artifacts),
        "controlled_artifact_count": sum(artifact.access == "controlled" for artifact in artifacts),
        "molecular_workflows": dict(sorted(workflow_counts.items())),
        "patient_leakage_count": 0,
    }
    _write_jsonl(
        output_root / "native-records.jsonl",
        [record.model_dump(mode="json") for record in records],
    )
    _write_jsonl(
        output_root / "artifacts.jsonl",
        [artifact.model_dump(mode="json") for artifact in artifacts],
    )
    _write_jsonl(
        output_root / "annotations.jsonl",
        [annotations[key] for key in sorted(annotations)],
    )
    _write_jsonl(output_root / "case-links.jsonl", links)
    _write_jsonl(output_root / "leakage-groups.jsonl", groups)
    _write_json(output_root / "missingness.json", {"fields": missingness})
    _write_json(output_root / "metrics.json", metrics)
    _write_json(
        output_root / "lineage.json",
        {
            "dataset_id": release.dataset_id,
            "data_release": release.data_release,
            "release_date": release.release_date,
            "official_active_manifest": release.official_active_manifest.model_dump(mode="json"),
            "query_contract": "contracts/queries.json",
            "rights_contract": "contracts/rights.json",
            "native_record_id_format": "gdc:file:<file_id>",
            "artifact_id_format": "<GDC file_id>",
        },
    )
    _write_json(
        output_root / "source-semantics.json",
        {
            "dataset_id": release.dataset_id,
            "publisher": "NCI Genomic Data Commons",
            "program": "TCGA",
            "publisher_roles": [],
            "publisher_role_status": (
                "GDC publishes no train, validation, or test roles for these records."
            ),
            "participant_identity": (
                "The GDC case submitter ID is retained as the TCGA participant barcode."
            ),
            "leakage_unit": "GDC case UUID",
            "stain_policy": (
                "Preserve GDC stain_type. Do not infer a stain when the field is absent."
            ),
            "downstream_boundary": (
                "No Pathologize cohort, tissue, stain, molecular-status, ontology, "
                "or split semantics."
            ),
        },
    )
    return metrics
