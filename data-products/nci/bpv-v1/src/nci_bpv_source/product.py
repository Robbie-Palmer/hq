from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, cast

from defusedxml import ElementTree

from nci_bpv_source.models import (
    AccessAndRights,
    AuthorizedRecord,
    IdentityContract,
    SourceInventory,
    StudyContract,
)

PROJECT_DIR = Path(__file__).resolve().parents[2]


class ProductError(RuntimeError):
    pass


def _read_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ProductError(f"{path} must contain a JSON object")
    return cast(dict[str, Any], value)


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _write_jsonl(path: Path, values: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = "".join(json.dumps(value, sort_keys=True) + "\n" for value in values)
    path.write_text(content, encoding="utf-8")


def load_contracts(
    root: Path = PROJECT_DIR,
) -> tuple[StudyContract, SourceInventory, AccessAndRights, IdentityContract]:
    study = StudyContract.model_validate(_read_object(root / "contracts/study.json"))
    inventory = SourceInventory.model_validate(
        _read_object(root / "contracts/source-inventory.json")
    )
    rights = AccessAndRights.model_validate(_read_object(root / "contracts/access-and-rights.json"))
    identity = IdentityContract.model_validate(
        _read_object(root / "contracts/identity-contract.json")
    )
    dataset_ids = {study.dataset_id, inventory.dataset_id, rights.dataset_id, identity.dataset_id}
    if len(dataset_ids) != 1:
        raise ProductError("contract dataset identifiers differ")
    return study, inventory, rights, identity


def verify_fixture_files(inventory: SourceInventory, fixture_root: Path) -> None:
    expected_names = {artifact.file_name for artifact in inventory.public_metadata_files}
    actual_names = {path.name for path in fixture_root.iterdir() if path.is_file()}
    if actual_names != expected_names:
        raise ProductError("public metadata fixtures differ from the source inventory")
    for artifact in inventory.public_metadata_files:
        path = fixture_root / artifact.file_name
        content = path.read_bytes()
        if len(content) != artifact.bytes:
            raise ProductError(f"{artifact.file_name}: byte count differs from inventory")
        if hashlib.sha256(content).hexdigest() != artifact.sha256:
            raise ProductError(f"{artifact.file_name}: SHA-256 differs from inventory")


def _text(element: Any, name: str) -> str | None:  # noqa: ANN401
    child = element.find(name)
    return child.text.strip() if child is not None and child.text else None


def _parse_dictionary(path: Path, substudy_accession: str) -> list[dict[str, Any]]:
    root = ElementTree.parse(path).getroot()
    table_accession = root.attrib.get("id")
    variables = [
        {
            "schema_version": "1.0.0",
            "substudy_accession": substudy_accession,
            "table_accession": table_accession,
            "variable_accession": variable.attrib["id"],
            "name": _text(variable, "name"),
            "description": _text(variable, "description"),
            "unit": _text(variable, "unit"),
            "comment": _text(variable, "comment"),
        }
        for variable in root.findall("variable")
    ]
    if not variables:
        raise ProductError(f"{path.name}: no variable definitions found")
    return variables


def _parse_summary(path: Path) -> list[dict[str, Any]]:
    root = ElementTree.parse(path).getroot()
    study_id = root.attrib.get("study_id")
    study_accession = f"{study_id}.p1"
    table_accession = root.attrib.get("dataset_id")
    values: list[dict[str, Any]] = []
    for variable in root.findall("variable"):
        stat = variable.find("total/stats/stat")
        if stat is None:
            raise ProductError(f"{path.name}: {variable.attrib['id']} has no total statistic")
        summaries = []
        stats = variable.find("total/stats")
        if stats is not None:
            for item in stats:
                if item.tag not in {"enum", "example"}:
                    continue
                summaries.append(
                    {
                        "kind": item.tag,
                        "value": item.text,
                        "count": int(item.attrib["count"]),
                        "code": item.attrib.get("code"),
                    }
                )
        values.append(
            {
                "schema_version": "1.0.0",
                "substudy_accession": study_accession,
                "table_accession": table_accession,
                "variable_accession": variable.attrib["id"],
                "name": variable.attrib.get("var_name"),
                "description": _text(variable, "description"),
                "calculated_type": variable.attrib.get("calculated_type"),
                "reported_type": variable.attrib.get("reported_type"),
                "units": variable.attrib.get("units"),
                "statistics": dict(sorted(stat.attrib.items())),
                "public_summary_values": summaries,
            }
        )
    if not values:
        raise ProductError(f"{path.name}: no public variable summaries found")
    return values


def _validate_study_exchange(path: Path, study: StudyContract) -> None:
    root = ElementTree.parse(path).getroot()
    content = ElementTree.tostring(root, encoding="unicode")
    if study.study_accession.removesuffix(".p1") not in content:
        raise ProductError("study exchange is missing the parent study accession")


def _validate_native_variables(study: StudyContract, variables: list[dict[str, Any]]) -> None:
    by_study: dict[str, set[str]] = {}
    for variable in variables:
        name = variable["name"]
        if name is not None:
            by_study.setdefault(variable["substudy_accession"], set()).add(name)
    for substudy in study.substudies:
        missing = set(substudy.required_variables) - by_study.get(substudy.accession, set())
        if missing:
            raise ProductError(
                f"{substudy.accession}: public dictionary is missing {', '.join(sorted(missing))}"
            )


def publish_product(
    fixture_root: Path | None = None,
    output_root: Path | None = None,
    *,
    root: Path = PROJECT_DIR,
) -> dict[str, object]:
    fixtures = fixture_root or root / "fixtures/public-metadata"
    outputs = output_root or root / "outputs"
    study, inventory, rights, identity = load_contracts(root)
    verify_fixture_files(inventory, fixtures)
    _validate_study_exchange(fixtures / "GapExchange_phs001304.v1.p1.xml", study)

    table_to_study = {item.table_accession: item.accession for item in study.substudies}
    variables: list[dict[str, Any]] = []
    summaries: list[dict[str, Any]] = []
    for artifact in inventory.public_metadata_files:
        path = fixtures / artifact.file_name
        if artifact.kind == "data_dictionary":
            table = next(
                (table for table in table_to_study if table in artifact.file_name),
                None,
            )
            if table is None:
                raise ProductError(f"{artifact.file_name}: no matching substudy table")
            variables.extend(_parse_dictionary(path, table_to_study[table]))
        elif artifact.kind == "variable_report":
            summaries.extend(_parse_summary(path))
    _validate_native_variables(study, variables)
    summary_studies = {item["substudy_accession"] for item in summaries}
    expected_studies = {item.accession for item in study.substudies}
    if summary_studies != expected_studies:
        raise ProductError("public variable reports differ from the seven pinned substudies")

    missingness = [
        {
            "schema_version": "1.0.0",
            "substudy_accession": item["substudy_accession"],
            "table_accession": item["table_accession"],
            "variable_accession": item["variable_accession"],
            "name": item["name"],
            "observed_count": int(item["statistics"].get("n", "0")),
            "missing_count": int(item["statistics"].get("nulls", "0")),
            "source": "dbGaP public aggregate variable report",
        }
        for item in summaries
    ]
    study_payload = study.model_dump(mode="json")
    inventory_payload = inventory.model_dump(mode="json")
    rights_payload = rights.model_dump(mode="json")
    identity_payload = identity.model_dump(mode="json")
    _write_json(outputs / "study.json", study_payload)
    _write_jsonl(
        outputs / "substudies.jsonl",
        [item.model_dump(mode="json") for item in study.substudies],
    )
    _write_jsonl(outputs / "variables.jsonl", variables)
    _write_jsonl(outputs / "summary-statistics.jsonl", summaries)
    _write_jsonl(outputs / "missingness.jsonl", missingness)
    _write_json(outputs / "source-inventory.json", inventory_payload)
    _write_json(outputs / "access-and-rights.json", rights_payload)
    _write_json(outputs / "identity-contract.json", identity_payload)
    metrics: dict[str, object] = {
        "controlled_dataset_family_count": len(inventory.controlled_dataset_families),
        "consented_subject_count": study.consented_subject_count,
        "dataset_id": study.dataset_id,
        "dictionary_variable_count": len(variables),
        "public_metadata_bytes": sum(item.bytes for item in inventory.public_metadata_files),
        "public_metadata_file_count": len(inventory.public_metadata_files),
        "substudy_count": len(study.substudies),
        "summary_missing_value_count": sum(int(item["missing_count"]) for item in missingness),
        "summary_variable_count": len(summaries),
    }
    _write_json(outputs / "metrics.json", metrics)
    return metrics


def validate_authorized_records(path: Path) -> dict[str, int]:
    records = [
        AuthorizedRecord.model_validate_json(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not records:
        raise ProductError("authorized record file is empty")
    record_ids = [record.record_id for record in records]
    if len(record_ids) != len(set(record_ids)):
        raise ProductError("authorized record IDs must be unique")
    specimen_ids = {record.specimen_id for record in records}
    aliquot_ids = {record.aliquot_id for record in records}
    for record in records:
        if record.matched_specimen_id and record.matched_specimen_id not in specimen_ids:
            raise ProductError("matched specimen link does not resolve within the validated export")
        if record.matched_aliquot_id and record.matched_aliquot_id not in aliquot_ids:
            raise ProductError("matched aliquot link does not resolve within the validated export")
    return {
        "artifact_count": sum(
            len(assay.artifacts) for record in records for assay in record.assays
        ),
        "assay_count": sum(len(record.assays) for record in records),
        "participant_count": len({record.participant_id for record in records}),
        "record_count": len(records),
        "substudy_count": len({record.substudy_accession for record in records}),
    }
