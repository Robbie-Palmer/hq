from __future__ import annotations

import csv
import json
import shutil
from collections import Counter
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from gtex_histology_source_data.models import HistologyRecord, MolecularRecord, SourceManifest
from gtex_histology_source_data.source import PROJECT_DIR, SourceDataError, load_manifest


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as source:
        return [json.loads(line) for line in source if line.strip()]


def _line(record: object) -> str:
    if isinstance(record, BaseModel):
        record = record.model_dump(mode="json")
    return json.dumps(record, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"


def _write_jsonl(path: Path, records: Iterable[object]) -> int:
    count = 0
    with path.open("w", encoding="utf-8", newline="\n") as output:
        for record in records:
            output.write(_line(record))
            count += 1
    return count


def _empty(value: str | None) -> str | None:
    if value is None or value.strip() == "":
        return None
    return value


def _integer(value: str | None) -> int | None:
    clean = _empty(value)
    return None if clean is None else int(clean)


def _decimal(value: str | None) -> float | None:
    clean = _empty(value)
    return None if clean is None else float(clean)


def _subject_id(sample_id: str) -> str | None:
    parts = sample_id.split("-")
    return "-".join(parts[:2]) if len(parts) >= 4 and parts[0] == "GTEX" else None


def _tissue_sample_id(sample_id: str) -> str:
    tissue_id, separator, _ = sample_id.partition("-SM-")
    if not separator:
        raise SourceDataError(f"molecular sample lacks aliquot separator: {sample_id}")
    return tissue_id


def _aliquot_id(sample_id: str) -> str:
    _, separator, aliquot = sample_id.partition("-SM-")
    if not separator:
        raise SourceDataError(f"molecular sample lacks aliquot separator: {sample_id}")
    return f"SM-{aliquot}"


def _subjects(path: Path) -> dict[str, dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as source:
        rows = list(csv.DictReader(source, delimiter="\t"))
    subjects = {row["SUBJID"]: row for row in rows}
    if len(subjects) != len(rows):
        raise SourceDataError("GTEx V8 subject IDs are not unique")
    return subjects


MOLECULAR_FIELDS = [
    "autolysis_score",
    "collection_site",
    "pathology_notes",
    "rin",
    "tissue_type",
    "tissue_site_detail",
    "uberon_id",
    "total_ischemic_time_minutes",
    "paxgene_fixative_time_minutes",
    "nucleic_acid_isolation_batch_id",
    "nucleic_acid_isolation_batch_type",
    "nucleic_acid_isolation_batch_date",
    "genotype_expression_batch_id",
    "genotype_expression_batch_date",
    "genotype_expression_batch_type",
    "analysis_freeze",
]


def _molecular_records(sample_path: Path, subject_path: Path) -> list[MolecularRecord]:
    subjects = _subjects(subject_path)
    records: list[MolecularRecord] = []
    with sample_path.open(encoding="utf-8", newline="") as source:
        for row in csv.DictReader(source, delimiter="\t"):
            sample_id = row["SAMPID"]
            subject_id = _subject_id(sample_id)
            subject = subjects.get(subject_id, {}) if subject_id is not None else {}
            if subject_id is not None and not subject:
                raise SourceDataError(f"molecular sample has no subject row: {sample_id}")
            values: dict[str, object] = {
                "sample_id": sample_id,
                "subject_id": subject_id,
                "tissue_sample_id": _tissue_sample_id(sample_id),
                "aliquot_id": _aliquot_id(sample_id),
                "autolysis_score": _integer(row.get("SMATSSCR")),
                "collection_site": _empty(row.get("SMCENTER")),
                "pathology_notes": _empty(row.get("SMPTHNTS")),
                "rin": _decimal(row.get("SMRIN")),
                "tissue_type": _empty(row.get("SMTS")),
                "tissue_site_detail": _empty(row.get("SMTSD")),
                "uberon_id": _empty(row.get("SMUBRID")),
                "total_ischemic_time_minutes": _integer(row.get("SMTSISCH")),
                "paxgene_fixative_time_minutes": _integer(row.get("SMTSPAX")),
                "nucleic_acid_isolation_batch_id": _empty(row.get("SMNABTCH")),
                "nucleic_acid_isolation_batch_type": _empty(row.get("SMNABTCHT")),
                "nucleic_acid_isolation_batch_date": _empty(row.get("SMNABTCHD")),
                "genotype_expression_batch_id": _empty(row.get("SMGEBTCH")),
                "genotype_expression_batch_date": _empty(row.get("SMGEBTCHD")),
                "genotype_expression_batch_type": _empty(row.get("SMGEBTCHT")),
                "analysis_freeze": _empty(row.get("SMAFRZE")),
                "age_bracket": _empty(subject.get("AGE")),
                "sex_code": _integer(subject.get("SEX")),
                "hardy_scale_code": _integer(subject.get("DTHHRDY")),
            }
            values["missing_fields"] = [
                field
                for field in [
                    *MOLECULAR_FIELDS,
                    "subject_id",
                    "age_bracket",
                    "sex_code",
                    "hardy_scale_code",
                ]
                if values[field] is None
            ]
            records.append(MolecularRecord.model_validate(values))
    return sorted(records, key=lambda record: record.sample_id)


def _histology_records(rows: list[dict[str, Any]]) -> list[HistologyRecord]:
    records: list[HistologyRecord] = []
    for row in rows:
        categories = sorted(
            key for key, present in row["pathologyNotesCategories"].items() if present
        )
        records.append(
            HistologyRecord(
                histology_image_id=row["histologyImageId"],
                subject_id=row["subjectId"],
                tissue_sample_id=row.get("tissueSampleId"),
                molecular_sample_id=row.get("sampleId"),
                tissue_site_detail=row["tissueSiteDetail"],
                sex=row["sex"],
                age_bracket=row["ageBracket"],
                hardy_scale=row["hardyScale"],
                pathology_notes=row.get("pathologyNotes"),
                pathology_categories=categories,
                hidden=row["hide"],
            )
        )
    return records


def _missing(records: Iterable[object], fields: list[str]) -> dict[str, int]:
    counts: Counter[str] = Counter()
    for record in records:
        for field in fields:
            value = getattr(record, field)
            if value is None or value == "" or value == []:
                counts[field] += 1
    return {field: counts[field] for field in fields}


def _small_difference(left: set[str], right: set[str]) -> list[str] | None:
    difference = sorted(left - right)
    return difference if len(difference) <= 100 else None


def _reconciliation(
    histology: list[HistologyRecord],
    molecular: list[MolecularRecord],
    anvil: list[dict[str, Any]],
    series: list[dict[str, Any]],
) -> dict[str, Any]:
    api_images = {record.histology_image_id for record in histology}
    anvil_images = {Path(row["file_name"]).stem for row in anvil}
    api_subjects = {record.subject_id for record in histology}
    idc_subjects = {str(row["PatientID"]) for row in series}
    api_molecular = {
        record.molecular_sample_id for record in histology if record.molecular_sample_id is not None
    }
    v8_molecular = {record.sample_id for record in molecular}
    containers = {str(row["ContainerIdentifier"]) for row in series}
    return {
        "schema_version": "1.0.0",
        "match_policy": "exact publisher identifiers only",
        "reported_count_difference": {
            "idc_series": len(series),
            "gtex_api_rows": len(histology),
            "gtex_api_minus_idc": len(histology) - len(series),
            "interpretation": (
                "The 210-row arithmetic difference is not a list of matched or missing slides. "
                "IDC and GTEx publish different image namespaces and no image-level crosswalk."
            ),
        },
        "gtex_api_to_anvil_svs": {
            "exact_image_id_matches": len(api_images & anvil_images),
            "gtex_api_only_count": len(api_images - anvil_images),
            "gtex_api_only_ids": _small_difference(api_images, anvil_images),
            "anvil_only_count": len(anvil_images - api_images),
            "anvil_only_ids": _small_difference(anvil_images, api_images),
        },
        "gtex_api_to_idc_subjects": {
            "exact_subject_matches": len(api_subjects & idc_subjects),
            "gtex_api_only_count": len(api_subjects - idc_subjects),
            "idc_only_count": len(idc_subjects - api_subjects),
            "gtex_api_only_ids": _small_difference(api_subjects, idc_subjects),
            "idc_only_ids": _small_difference(idc_subjects, api_subjects),
        },
        "gtex_api_to_v8_molecular": {
            "api_rows_with_molecular_sample_id": len(api_molecular),
            "exact_molecular_sample_matches": len(api_molecular & v8_molecular),
            "api_molecular_ids_absent_from_v8_count": len(api_molecular - v8_molecular),
        },
        "gtex_api_to_idc_images": {
            "exact_histology_id_to_container_matches": len(api_images & containers),
            "crosswalk_status": "unavailable",
            "reason": (
                "The publisher snapshots do not supply an image-level crosswalk. "
                "Container suffix patterns are not used to invent one."
            ),
        },
    }


def _expected_counts(manifest: SourceManifest) -> dict[str, int]:
    identities = {identity.name: identity for identity in manifest.identities}
    snapshots = {snapshot.name: snapshot for snapshot in manifest.snapshots}
    return {
        "gtex-histology-images.jsonl": snapshots["gtex_histology_api"].expected_records,
        "gtex-molecular-aliquots.jsonl": identities["GTEx Portal"].counts[
            "v8_sample_attribute_rows"
        ],
        "anvil-svs.jsonl": snapshots["anvil_svs"].expected_records,
        "idc-series.jsonl": snapshots["idc_series"].expected_records,
        "idc-instances.jsonl": snapshots["idc_instances"].expected_records,
    }


def _require_counts(counts: dict[str, int], expected: dict[str, int]) -> None:
    if counts != expected:
        raise SourceDataError(f"source record counts changed: {counts}")


def build_product(root: Path = PROJECT_DIR) -> dict[str, Any]:
    manifest = load_manifest(root)
    raw = root / "data/raw"
    if not (raw / "acquisition.json").is_file():
        raise SourceDataError("acquire metadata before indexing")
    histology = _histology_records(_read_jsonl(raw / "gtex-histology-api.jsonl"))
    anvil = _read_jsonl(raw / "anvil-svs.jsonl")
    series = _read_jsonl(raw / "idc-series.jsonl")
    instances = _read_jsonl(raw / "idc-instances.jsonl")
    static = raw / "static"
    molecular = _molecular_records(
        static / "GTEx_Analysis_v8_Annotations_SampleAttributesDS.txt",
        static / "GTEx_Analysis_v8_Annotations_SubjectPhenotypesDS.txt",
    )

    temporary = root / ".outputs.part"
    output = root / "outputs"
    shutil.rmtree(temporary, ignore_errors=True)
    temporary.mkdir()
    complete = False
    try:
        counts = {
            "gtex-histology-images.jsonl": _write_jsonl(
                temporary / "gtex-histology-images.jsonl", histology
            ),
            "gtex-molecular-aliquots.jsonl": _write_jsonl(
                temporary / "gtex-molecular-aliquots.jsonl", molecular
            ),
            "anvil-svs.jsonl": _write_jsonl(temporary / "anvil-svs.jsonl", anvil),
            "idc-series.jsonl": _write_jsonl(temporary / "idc-series.jsonl", series),
            "idc-instances.jsonl": _write_jsonl(temporary / "idc-instances.jsonl", instances),
        }
        expected = _expected_counts(manifest)
        _require_counts(counts, expected)

        metrics: dict[str, Any] = {
            "dataset_id": manifest.dataset_id,
            "record_counts": counts,
            "histology_subject_count": len({record.subject_id for record in histology}),
            "molecular_subject_count": len(
                {record.subject_id for record in molecular if record.subject_id is not None}
            ),
            "idc_subject_count": len({row["PatientID"] for row in series}),
            "idc_study_count": len({row["StudyInstanceUID"] for row in series}),
            "idc_instance_bytes": sum(int(row["instance_size"]) for row in instances),
            "anvil_svs_bytes": sum(int(row["file_size"]) for row in anvil),
            "source_values": {
                "idc_licenses": dict(
                    sorted(Counter(row["license_short_name"] for row in series).items())
                ),
                "idc_source_dois": dict(
                    sorted(Counter(row["source_DOI"] for row in series).items())
                ),
                "idc_fixatives": dict(
                    sorted(
                        Counter(str(row["tissueFixative_CodeMeaning"]) for row in series).items()
                    )
                ),
                "idc_embedding_media": dict(
                    sorted(
                        Counter(str(row["embeddingMedium_CodeMeaning"]) for row in series).items()
                    )
                ),
                "idc_stains": dict(
                    sorted(
                        Counter(
                            str(row["staining_usingSubstance_CodeMeaning"]) for row in series
                        ).items()
                    )
                ),
            },
            "missingness": {
                "gtex_histology": _missing(
                    histology,
                    [
                        "tissue_sample_id",
                        "molecular_sample_id",
                        "pathology_notes",
                        "pathology_categories",
                    ],
                ),
                "gtex_molecular": _missing(molecular, MOLECULAR_FIELDS),
                "idc_series": {
                    field: sum(row.get(field) in (None, "", []) for row in series)
                    for field in [
                        "ContainerIdentifier",
                        "primaryAnatomicStructure_CodeMeaning",
                        "tissueFixative_CodeMeaning",
                        "embeddingMedium_CodeMeaning",
                        "staining_usingSubstance_CodeMeaning",
                    ]
                },
                "anvil_svs": {
                    field: sum(row.get(field) in (None, "", []) for row in anvil)
                    for field in ["file_size", "file_md5sum", "drs_uri", "azul_url"]
                },
                "acceptability": {
                    "missing_from_acquired_current_sources": len(histology),
                    "note": (
                        "The retired NCI BRD viewer published acceptability. The current GTEx API, "
                        "IDC index, and AnVIL index do not expose that field."
                    ),
                },
            },
        }
        reconciliation = _reconciliation(histology, molecular, anvil, series)
        (temporary / "source-metrics.json").write_text(
            json.dumps(metrics, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        (temporary / "reconciliation.json").write_text(
            json.dumps(reconciliation, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        shutil.rmtree(output, ignore_errors=True)
        temporary.replace(output)
        complete = True
        return metrics
    finally:
        if not complete:
            shutil.rmtree(temporary, ignore_errors=True)
