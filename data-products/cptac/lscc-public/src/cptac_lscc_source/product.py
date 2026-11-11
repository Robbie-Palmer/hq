from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, cast

from cptac_lscc_source.models import (
    ArtifactReference,
    NativeRecord,
    ParticipantLink,
    ParticipantMissingness,
    SnapshotManifest,
    SourceContract,
    SpecimenLink,
)

PROJECT_DIR = Path(__file__).resolve().parents[2]


class ProductError(RuntimeError):
    pass


def _read_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ProductError(f"{path} must contain a JSON object")
    return cast(dict[str, Any], payload)


def _read_native(path: Path) -> list[NativeRecord]:
    return [
        NativeRecord.model_validate_json(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _write_jsonl(path: Path, values: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(value, sort_keys=True) + "\n" for value in values),
        encoding="utf-8",
    )


def _verify_snapshots(root: Path, manifest: SnapshotManifest) -> None:
    declared = {item.path for item in manifest.files}
    expected = {
        "snapshots/tcia-collection.json",
        "snapshots/tcia-slides.jsonl",
        "snapshots/pdc-studies.jsonl",
        "snapshots/pdc-biospecimens.jsonl",
        "snapshots/pdc-clinical.jsonl",
        "snapshots/pdc-files.jsonl",
        "snapshots/gdc-status.json",
        "snapshots/gdc-cases.jsonl",
        "snapshots/gdc-files.jsonl",
    }
    if declared != expected:
        raise ProductError("snapshot manifest file set differs from the product contract")
    for item in manifest.files:
        path = root / item.path
        if not path.is_file():
            raise ProductError(f"missing snapshot file: {item.path}")
        if hashlib.sha256(path.read_bytes()).hexdigest() != item.sha256:
            raise ProductError(f"snapshot checksum differs: {item.path}")
        records = len(path.read_text(encoding="utf-8").splitlines())
        if path.suffix == ".json":
            records = 1
        if records != item.records:
            raise ProductError(f"snapshot record count differs: {item.path}")


def _tcia_artifacts(
    slides: list[NativeRecord], stain: str, stain_evidence: str
) -> list[ArtifactReference]:
    artifacts: list[ArtifactReference] = []
    for record in slides:
        native = record.native
        slide_id = str(native["Slide_ID"])
        artifacts.append(
            ArtifactReference(
                artifact_ref=f"tcia:CPTAC-LSCC:slide:{slide_id}",
                repository="TCIA",
                native_id=str(native["Pathology"]),
                participant_ids=[str(native["Case_ID"])],
                specimen_ids=[str(native["Specimen_ID"])],
                format="SVS",
                assay=f"{stain} whole slide image",
                assay_evidence=stain_evidence,
                access_tier="public",
                locator=(
                    "https://pathdb.cancerimagingarchive.net/node/"
                    f"{native['Pathology']}?_format=json"
                ),
                missing_checksum_reason=(
                    "TCIA publishes the CPTAC-LSCC SVS package without per-slide checksums in "
                    "the public PathDB metadata export."
                ),
            )
        )
    return artifacts


def _pdc_artifacts(
    files: list[NativeRecord], study_by_uuid: dict[str, dict[str, Any]]
) -> list[ArtifactReference]:
    artifacts: list[ArtifactReference] = []
    for record in files:
        native = record.native
        study = study_by_uuid[str(native["study_id"])]
        checksum = native.get("md5sum") or None
        size = native.get("file_size")
        artifacts.append(
            ArtifactReference(
                artifact_ref=f"pdc:{native['pdc_study_id']}:file:{native['file_id']}",
                repository="PDC",
                native_id=str(native["file_id"]),
                participant_ids=[],
                specimen_ids=[],
                study_ref=f"pdc:study:{native['pdc_study_id']}:{native['study_id']}",
                file_name=str(native["file_name"]),
                format=str(native["file_format"]),
                assay=f"{study['analytical_fraction']} / {study['experiment_type']}",
                bytes=int(size) if size not in (None, "") else None,
                checksum_algorithm="md5" if checksum else None,
                checksum=str(checksum) if checksum else None,
                access_tier="open",
                locator=f"pdc:{native['file_location']}",
                missing_checksum_reason=None if checksum else "PDC did not publish an MD5 value.",
            )
        )
    return artifacts


def _gdc_artifacts(files: list[NativeRecord]) -> list[ArtifactReference]:
    artifacts: list[ArtifactReference] = []
    for record in files:
        native = record.native
        cases = cast(list[dict[str, Any]], native.get("cases", []))
        participant_ids = sorted({str(item["submitter_id"]) for item in cases})
        specimen_ids = sorted(
            {
                str(sample["submitter_id"])
                for case in cases
                for sample in cast(list[dict[str, Any]], case.get("samples", []))
            }
        )
        checksum = native.get("md5sum") or None
        artifacts.append(
            ArtifactReference(
                artifact_ref=f"gdc:file:{native['file_id']}",
                repository="GDC",
                native_id=str(native["file_id"]),
                participant_ids=participant_ids,
                specimen_ids=specimen_ids,
                file_name=str(native["file_name"]),
                format=str(native["data_format"]),
                assay=str(native.get("experimental_strategy") or native["data_type"]),
                bytes=int(native["file_size"]),
                checksum_algorithm="md5" if checksum else None,
                checksum=str(checksum) if checksum else None,
                access_tier=native["access"],
                locator=f"https://api.gdc.cancer.gov/data/{native['file_id']}",
                missing_checksum_reason=None if checksum else "GDC did not publish an MD5 value.",
            )
        )
    return artifacts


def _sample_submitter_ids(case: dict[str, Any]) -> set[str]:
    return {
        str(sample["submitter_id"])
        for sample in cast(list[dict[str, Any]], case.get("samples", []))
    }


def _build_participants(
    contract: SourceContract,
    slides: list[NativeRecord],
    pdc_biospecimens: list[NativeRecord],
    pdc_clinical: list[NativeRecord],
    gdc_cases: list[NativeRecord],
    gdc_files: list[NativeRecord],
) -> list[ParticipantLink]:
    slides_by_case: dict[str, list[NativeRecord]] = defaultdict(list)
    for slide in slides:
        slides_by_case[str(slide.native["Case_ID"])].append(slide)
    pdc_by_case: dict[str, list[NativeRecord]] = defaultdict(list)
    for specimen in pdc_biospecimens:
        pdc_by_case[str(specimen.native["case_submitter_id"])].append(specimen)
    clinical_by_case: dict[str, list[NativeRecord]] = defaultdict(list)
    for record in pdc_clinical:
        clinical_by_case[str(record.native["case_submitter_id"])].append(record)
    gdc_by_case = {str(case.native["submitter_id"]): case for case in gdc_cases}
    gdc_files_by_case: dict[str, list[NativeRecord]] = defaultdict(list)
    for file in gdc_files:
        for case in cast(list[dict[str, Any]], file.native.get("cases", [])):
            gdc_files_by_case[str(case["submitter_id"])].append(file)

    participants: list[ParticipantLink] = []
    identity_url = str(contract.cohort.participant_identity_statement_url)
    for case_id in sorted(slides_by_case):
        case_slides = slides_by_case[case_id]
        pdc_records = pdc_by_case.get(case_id, [])
        clinical_records = clinical_by_case.get(case_id, [])
        gdc_case = gdc_by_case.get(case_id)
        case_gdc_files = gdc_files_by_case.get(case_id, [])
        pdc_sample_ids = {str(item.native["sample_submitter_id"]) for item in pdc_records}
        gdc_sample_ids = _sample_submitter_ids(gdc_case.native) if gdc_case else set()
        specimen_links = [
            SpecimenLink(
                tcia_specimen_id=specimen_id,
                pdc_sample_refs=(
                    [f"pdc:sample:{specimen_id}"] if specimen_id in pdc_sample_ids else []
                ),
                gdc_sample_refs=(
                    [f"gdc:sample:{specimen_id}"] if specimen_id in gdc_sample_ids else []
                ),
                match_method="exact_submitter_id",
            )
            for specimen_id in sorted({str(item.native["Specimen_ID"]) for item in case_slides})
        ]
        participants.append(
            ParticipantLink(
                product_id=contract.product_id,
                participant_ref=f"cptac:CPTAC-LSCC:participant:{case_id}",
                publisher_participant_id=case_id,
                tumour_type=str(case_slides[0].native["Disease_Type"]),
                tcia_collection_id=contract.cohort.collection_id,
                tcia_slide_refs=sorted(
                    f"tcia:CPTAC-LSCC:slide:{item.native['Slide_ID']}" for item in case_slides
                ),
                pdc_case_refs=sorted(
                    {f"pdc:case:{item.native['case_id']}" for item in pdc_records}
                ),
                pdc_clinical_refs=sorted(
                    f"pdc:clinical:{item.native['pdc_study_id']}:{item.native['case_id']}"
                    for item in clinical_records
                ),
                pdc_study_refs=sorted(
                    {
                        f"pdc:study:{item.native['pdc_study_id']}:{item.native['study_id']}"
                        for item in pdc_records
                    }
                ),
                gdc_case_refs=[f"gdc:case:{gdc_case.native_id}"] if gdc_case else [],
                gdc_file_refs=sorted(f"gdc:file:{item.native_id}" for item in case_gdc_files),
                specimen_links=specimen_links,
                missingness=ParticipantMissingness(
                    tcia_slide=not case_slides,
                    pdc_proteomic_study=not pdc_records,
                    gdc_case=gdc_case is None,
                    gdc_genomic_file=not case_gdc_files,
                ),
                linkage_evidence=[
                    identity_url,
                    *sorted(
                        {
                            str(reference["reference_entity_location"])
                            for item in pdc_records
                            for reference in cast(
                                list[dict[str, Any]], item.native.get("externalReferences", [])
                            )
                            if reference.get("reference_resource_shortname") in {"TCIA", "GDC"}
                        }
                    ),
                ],
            )
        )
    return participants


def publish_product(root: Path = PROJECT_DIR) -> dict[str, object]:
    contract = SourceContract.model_validate(_read_object(root / "contracts/sources.json"))
    manifest = SnapshotManifest.model_validate(
        _read_object(root / "snapshots/snapshot-manifest.json")
    )
    if manifest.product_id != contract.product_id:
        raise ProductError("snapshot and source contract product identifiers differ")
    _verify_snapshots(root, manifest)

    slides = _read_native(root / "snapshots/tcia-slides.jsonl")
    studies = _read_native(root / "snapshots/pdc-studies.jsonl")
    pdc_biospecimens = _read_native(root / "snapshots/pdc-biospecimens.jsonl")
    pdc_clinical = _read_native(root / "snapshots/pdc-clinical.jsonl")
    pdc_files = _read_native(root / "snapshots/pdc-files.jsonl")
    gdc_cases = _read_native(root / "snapshots/gdc-cases.jsonl")
    gdc_files = _read_native(root / "snapshots/gdc-files.jsonl")
    study_by_uuid = {str(item.native["study_id"]): item.native for item in studies}

    artifacts = [
        *_tcia_artifacts(
            slides,
            contract.artifact_policy.tcia_slide_stain,
            str(contract.artifact_policy.tcia_slide_stain_evidence_url),
        ),
        *_pdc_artifacts(pdc_files, study_by_uuid),
        *_gdc_artifacts(gdc_files),
    ]
    if len({item.artifact_ref for item in artifacts}) != len(artifacts):
        raise ProductError("artifact references must be unique")
    participants = _build_participants(
        contract, slides, pdc_biospecimens, pdc_clinical, gdc_cases, gdc_files
    )
    if len(participants) != 212 or sum(len(item.tcia_slide_refs) for item in participants) != 1081:
        raise ProductError("published cohort no longer matches the pinned TCIA release")

    output_root = root / "outputs"
    _write_jsonl(
        output_root / "native-index.jsonl",
        [item.model_dump(mode="json") for item in participants],
    )
    _write_jsonl(
        output_root / "artifact-index.jsonl",
        [
            item.model_dump(mode="json")
            for item in sorted(artifacts, key=lambda item: item.artifact_ref)
        ],
    )
    missing_counts = {
        name: sum(getattr(item.missingness, name) for item in participants)
        for name in ParticipantMissingness.model_fields
    }
    _write_json(
        output_root / "missingness.json",
        {
            "schema_version": "1.0.0",
            "product_id": contract.product_id,
            "boolean_meaning": "true means the repository-native record or artifact is absent",
            "participant_count": len(participants),
            "missing_participant_counts": missing_counts,
        },
    )
    _write_json(
        output_root / "lineage.json",
        {
            "schema_version": "1.0.0",
            "product_id": contract.product_id,
            "snapshot_manifest": "snapshots/snapshot-manifest.json",
            "source_contract": "contracts/sources.json",
            "repositories": [item.model_dump(mode="json") for item in contract.repositories],
            "linkage_rules": [
                "TCIA Case_ID is the cohort participant identifier.",
                "PDC case_submitter_id and GDC submitter_id match TCIA Case_ID exactly.",
                "Specimens link only when repository submitter identifiers match exactly.",
                "No missing repository identity is inferred or synthesized.",
            ],
        },
    )
    strategies = Counter(
        str(item.native.get("experimental_strategy") or "not_applicable") for item in gdc_files
    )
    access_tiers = Counter(str(item.native["access"]) for item in gdc_files)
    metrics: dict[str, object] = {
        "product_id": contract.product_id,
        "participant_count": len(participants),
        "specimen_count": len({str(item.native["Specimen_ID"]) for item in slides}),
        "tcia_slide_count": len(slides),
        "pdc_study_count": len(studies),
        "pdc_biospecimen_count": len(pdc_biospecimens),
        "pdc_clinical_record_count": len(pdc_clinical),
        "pdc_artifact_count": len(pdc_files),
        "gdc_case_count": len(gdc_cases),
        "gdc_file_count": len(gdc_files),
        "gdc_files_by_access": dict(sorted(access_tiers.items())),
        "gdc_files_by_experimental_strategy": dict(sorted(strategies.items())),
        "missing_participant_counts": missing_counts,
    }
    _write_json(output_root / "metrics.json", metrics)
    return metrics
