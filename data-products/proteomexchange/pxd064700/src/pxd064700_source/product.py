from __future__ import annotations

import csv
import hashlib
import re
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path, PureWindowsPath
from typing import Any, cast
from urllib.parse import quote

from data_artifacts.acquisition import RemoteFile
from data_artifacts.files import read_json, write_json, write_jsonl

from pxd064700_source.models import (
    ArtifactRecord,
    PairingRecord,
    PreparationToken,
    RegionToken,
    RunRecord,
    SnapshotManifest,
    SourceContract,
)

PROJECT_DIR = Path(__file__).resolve().parents[2]
RUN_PATTERN = re.compile(
    r"^(?P<prefix>\d{8}_176-2021-12)(?P<batch_separator>[-_])"
    r"B(?P<batch>\d+)(?:(?P<injection_separator>[-_])Inj(?P<injection>\d+))?"
    r"-(?P<preparation>FFPE-Kit|FFPE|Fresh|Form)-KS-"
    r"(?P<donor>\d+-\d+)-(?P<region>Cx|HC)-b(?P<biological>\d+)-"
    r"t(?P<technical>\d+)-(?P<date>\d{2}-\d{2}-\d{4})-LP\.raw$"
)
SHA1_PATTERN = re.compile(r"^[0-9a-f]{40}$")
CHECKSUM_FILE_NAME = "checksum.txt"
COMMUNITY_SDRF_FILE_NAME = "PXD064700_community_annotated.sdrf.tsv"
REQUIRED_SNAPSHOT_PATHS = frozenset(
    {
        f"snapshots/{CHECKSUM_FILE_NAME}",
        "snapshots/community-annotation.sdrf.tsv",
        "snapshots/donor-name-map.tsv",
        "snapshots/experiment-overview.txt",
        "snapshots/ftp-listing.jsonl",
        "snapshots/pride-project.json",
        "snapshots/proteomexchange-announcement.xml",
    }
)
EXPECTED_UNCHECKSUMMED_FILES = frozenset({COMMUNITY_SDRF_FILE_NAME, CHECKSUM_FILE_NAME})


class ProductError(RuntimeError):
    pass


def _read_object(path: Path) -> dict[str, Any]:
    value = read_json(path)
    if not isinstance(value, dict):
        raise ProductError(f"expected JSON object in {path}")
    return cast(dict[str, Any], value)


def _verify_snapshots(root: Path, manifest: SnapshotManifest) -> None:
    listed_paths = {snapshot.path for snapshot in manifest.files}
    missing_paths = REQUIRED_SNAPSHOT_PATHS - listed_paths
    if missing_paths:
        raise ProductError(f"snapshot manifest omits required paths: {sorted(missing_paths)}")
    for snapshot in manifest.files:
        path = root / snapshot.path
        payload = path.read_bytes()
        if len(payload) != snapshot.bytes:
            raise ProductError(f"snapshot byte count differs: {snapshot.path}")
        if hashlib.sha256(payload).hexdigest() != snapshot.sha256:
            raise ProductError(f"snapshot checksum differs: {snapshot.path}")


def read_ftp_entries(path: Path) -> list[RemoteFile]:
    return [
        RemoteFile.model_validate_json(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]


def _announcement_files(root: ET.Element) -> dict[str, dict[str, str]]:
    if root.attrib.get("id") != "PXD064700":
        raise ProductError("ProteomeXchange announcement accession differs")
    summary = root.find("DatasetSummary")
    if summary is None or summary.attrib.get("announceDate") != "2026-03-17":
        raise ProductError("ProteomeXchange announcement date differs")
    files: dict[str, dict[str, str]] = {}
    for element in root.findall("./DatasetFileList/DatasetFile"):
        name = element.attrib["name"]
        parameter = element.find("cvParam")
        if parameter is None:
            raise ProductError(f"announcement file has no category: {name}")
        files[name] = {
            "id": element.attrib["id"],
            "category": parameter.attrib["name"],
            "category_accession": parameter.attrib["accession"],
            "locator": parameter.attrib["value"],
        }
    if len(files) != 551:
        raise ProductError("ProteomeXchange revision 1 must announce 551 file references")
    return files


def announcement_files(path: Path) -> dict[str, dict[str, str]]:
    root = ET.parse(path).getroot()  # noqa: S314 - pinned local publisher metadata.
    return _announcement_files(root)


def announcement_files_from_bytes(payload: bytes) -> dict[str, dict[str, str]]:
    root = ET.fromstring(payload)  # noqa: S314 - public publisher metadata.
    return _announcement_files(root)


def _checksums(path: Path) -> dict[str, tuple[str, str]]:
    rows = path.read_text(encoding="utf-8").splitlines()
    if not rows or rows[0] != "#Checksum File":
        raise ProductError("publisher checksum header differs")
    checksums: dict[str, tuple[str, str]] = {}
    for row in rows[1:]:
        source_path, checksum = row.split("\t", 1)
        basename = PureWindowsPath(source_path).name
        if not SHA1_PATTERN.fullmatch(checksum):
            raise ProductError(f"invalid publisher SHA-1 for {basename}")
        if basename in checksums:
            raise ProductError(f"duplicate checksum basename: {basename}")
        checksums[basename] = (checksum, source_path)
    if len(checksums) != 550:
        raise ProductError("publisher checksum file must contain 550 artifacts")
    return checksums


def _sdrf_rows(path: Path) -> dict[str, list[dict[str, str]]]:
    with path.open(encoding="utf-8", newline="") as stream:
        rows = list(csv.reader(stream, delimiter="\t"))
    headers = rows[0]
    counts: Counter[str] = Counter()
    unique_headers: list[str] = []
    for header in headers:
        counts[header] += 1
        occurrence = counts[header]
        unique_headers.append(header if occurrence == 1 else f"{header}#{occurrence}")
    data_file_index = headers.index("comment[data file]")
    indexed: dict[str, list[dict[str, str]]] = {}
    for row in rows[1:]:
        if len(row) != len(headers):
            raise ProductError("SDRF row length differs from its header")
        file_name = row[data_file_index]
        indexed[file_name] = [
            {"column": header, "value": value}
            for header, value in zip(unique_headers, row, strict=True)
        ]
    if len(indexed) != 269:
        raise ProductError("community SDRF must describe 269 raw runs")
    return indexed


def _donor_map(path: Path) -> dict[str, int]:
    with path.open(encoding="utf-8", newline="") as stream:
        rows = list(csv.reader(stream, delimiter="\t"))
    expected_header = ["Case (number in paper)", "Body donor number (in .raw data)"]
    if rows[0] != expected_header:
        raise ProductError("donor map header differs")
    mapping = {donor: int(case) for case, donor in rows[1:]}
    if len(mapping) != 8 or set(mapping.values()) != set(range(1, 9)):
        raise ProductError("donor map must retain all eight published cases")
    return mapping


def _artifact_ref(file_name: str) -> str:
    return f"proteomexchange:PXD064700:revision:1:file:{quote(file_name, safe='')}"


def _artifact_role(file_name: str) -> str:
    exact_roles = {
        "20240722_DIA-NN.gg_matrix.tsv": "DIA-NN gene-group quantity matrix",
        "20240722_DIA-NN.log.txt": "DIA-NN search log and parameters",
        "20240722_DIA-NN.pg_matrix.tsv": "DIA-NN protein-group quantity matrix",
        "20240722_DIA-NN.pr_matrix.tsv": "DIA-NN precursor and peptide quantity matrix",
        "20240722_DIA-NN.stats.tsv": "DIA-NN run quality-control statistics",
        "20240722_DIA-NN.tsv": "DIA-NN protein, peptide, and precursor report",
        "20240722_DIA-NN.unique_genes_matrix.tsv": "DIA-NN unique-gene quantity matrix",
        COMMUNITY_SDRF_FILE_NAME: "community sample and assay metadata",
        "UP000005640_9606.fasta": "human protein sequence database",
        CHECKSUM_FILE_NAME: "publisher SHA-1 manifest",
        "experiment_overview_and_software.txt": "experiment and software overview",
        "reference_case_name_for_raw_data_equivalent_body_donor_number.txt": (
            "paper-case to body-donor map"
        ),
        "shorter_library_generated.tsv": "DIA-NN spectral library table",
        "shorter_library_generated.tsv.speclib": "DIA-NN binary spectral library",
    }
    if file_name.endswith(".raw.quant"):
        return "raw-run quantification sidecar"
    if file_name.endswith(".raw"):
        return "Orbitrap raw DIA run"
    try:
        return exact_roles[file_name]
    except KeyError as error:
        raise ProductError(f"unclassified source artifact: {file_name}") from error


def _missing_checksum_reason(file_name: str, checksum: tuple[str, str] | None) -> str | None:
    if checksum is not None:
        return None
    if file_name == CHECKSUM_FILE_NAME:
        return "The publisher checksum file cannot checksum itself."
    return "The community SDRF was added after revision 1 and is absent from checksum.txt."


def _validate_artifact_coverage(
    ftp_names: set[str],
    announced: dict[str, dict[str, str]],
    checksums: dict[str, tuple[str, str]],
) -> None:
    if set(checksums) - ftp_names:
        raise ProductError("publisher checksum basename is absent from the FTP listing")
    if set(announced) - ftp_names:
        raise ProductError("announced file is absent from the FTP listing")
    unchecksummed_files = ftp_names - set(checksums)
    if unchecksummed_files != EXPECTED_UNCHECKSUMMED_FILES:
        raise ProductError(
            "publisher checksum coverage differs; expected unchecksummed files: "
            f"{sorted(EXPECTED_UNCHECKSUMMED_FILES)}; observed: {sorted(unchecksummed_files)}"
        )


def _artifacts(
    ftp_entries: list[RemoteFile],
    announced: dict[str, dict[str, str]],
    checksums: dict[str, tuple[str, str]],
) -> list[ArtifactRecord]:
    ftp_names = {entry.file_name for entry in ftp_entries}
    _validate_artifact_coverage(ftp_names, announced, checksums)
    artifacts: list[ArtifactRecord] = []
    for entry in ftp_entries:
        announcement = announced.get(entry.file_name)
        checksum = checksums.get(entry.file_name)
        reason = _missing_checksum_reason(entry.file_name, checksum)
        artifacts.append(
            ArtifactRecord(
                artifact_ref=_artifact_ref(entry.file_name),
                file_name=entry.file_name,
                native_artifact_role=_artifact_role(entry.file_name),
                bytes=entry.bytes,
                locator=entry.locator,
                announcement_file_id=announcement["id"] if announcement else None,
                announcement_category=announcement["category"] if announcement else None,
                announcement_category_accession=(
                    announcement["category_accession"] if announcement else None
                ),
                sha1=checksum[0] if checksum else None,
                checksum_source_path=checksum[1] if checksum else None,
                checksum_basename_matches_listing=True if checksum else None,
                missing_checksum_reason=reason,
            )
        )
    return artifacts


def _file_naming_variants(match: re.Match[str]) -> list[str]:
    variants: list[str] = []
    if match.group("batch_separator") == "-":
        variants.append("hyphen_before_batch_instead_of_majority_underscore")
    injection_separator = match.group("injection_separator")
    if injection_separator == "_":
        variants.append("underscore_before_injection_marker")
    return variants


def _runs(
    contract: SourceContract,
    artifacts: list[ArtifactRecord],
    sdrf: dict[str, list[dict[str, str]]],
    donors: dict[str, int],
) -> list[RunRecord]:
    artifact_by_name = {item.file_name: item for item in artifacts}
    preparations = {item.filename_token: item for item in contract.preparations}
    runs: list[RunRecord] = []
    for file_name in sorted(name for name in artifact_by_name if name.endswith(".raw")):
        match = RUN_PATTERN.fullmatch(file_name)
        if match is None:
            raise ProductError(f"raw filename does not match the native run grammar: {file_name}")
        quant_name = f"{file_name}.quant"
        if quant_name not in artifact_by_name:
            raise ProductError(f"raw run has no quant sidecar: {file_name}")
        if file_name not in sdrf:
            raise ProductError(f"raw run has no SDRF row: {file_name}")
        donor = match.group("donor")
        if donor not in donors:
            raise ProductError(f"raw run donor is absent from the publisher map: {donor}")
        preparation_token = cast(PreparationToken, match.group("preparation"))
        preparation = preparations[preparation_token]
        region_token = cast(RegionToken, match.group("region"))
        region = contract.study_context.regions[region_token]
        run_name = file_name.removesuffix(".raw")
        runs.append(
            RunRecord(
                run_ref=f"proteomexchange:PXD064700:revision:1:run:{quote(run_name, safe='')}",
                run_name=run_name,
                raw_artifact_ref=artifact_by_name[file_name].artifact_ref,
                quant_artifact_ref=artifact_by_name[quant_name].artifact_ref,
                case_number=donors[donor],
                body_donor_number=donor,
                brain_region_token=region_token,
                brain_region=region,
                preparation_token=preparation_token,
                preservation=preparation.preservation,
                extraction=preparation.extraction,
                batch=f"B{match.group('batch')}",
                injection_marker=(
                    f"Inj{match.group('injection')}" if match.group("injection") else None
                ),
                biological_replicate=int(match.group("biological")),
                technical_replicate=int(match.group("technical")),
                acquisition_date=match.group("date"),
                file_naming_variants=_file_naming_variants(match),
                sdrf_annotation_provenance="PRIDE community annotation; submitter-unverified",
                sdrf_native=sdrf[file_name],
                instrument=contract.assay.instrument,
                acquisition=contract.assay.acquisition,
                quantification=contract.assay.quantification,
            )
        )
    if len(runs) != 269:
        raise ProductError("source release must contain 269 raw runs")
    return runs


def _pairings(contract: SourceContract, runs: list[RunRecord]) -> list[PairingRecord]:
    grouped: dict[tuple[str, RegionToken, int], list[RunRecord]] = defaultdict(list)
    for run in runs:
        grouped[(run.body_donor_number, run.brain_region_token, run.biological_replicate)].append(
            run
        )
    records: list[PairingRecord] = []
    for (donor, region_token, biological), group in sorted(grouped.items()):
        by_preparation: dict[str, list[str]] = defaultdict(list)
        for run in group:
            by_preparation[run.preparation_token].append(run.run_ref)
        case_number = group[0].case_number
        records.append(
            PairingRecord(
                pairing_ref=(
                    "proteomexchange:PXD064700:revision:1:pairing:"
                    f"case-{case_number}:{region_token}:b{biological}"
                ),
                case_number=case_number,
                body_donor_number=donor,
                brain_region_token=region_token,
                brain_region=contract.study_context.regions[region_token],
                biological_replicate=biological,
                pairing_basis="publisher filename donor, region, and biological-replicate tokens",
                physical_specimen_identity_asserted=False,
                run_refs_by_preparation={
                    key: sorted(value) for key, value in sorted(by_preparation.items())
                },
            )
        )
    return records


def _expected_comparison_runs(
    donors: dict[str, int],
) -> set[tuple[str, str, str, int, int]]:
    comparison_donors = sorted(donor for donor, case in donors.items() if case <= 6)
    return {
        (donor, region, preparation, biological, technical)
        for donor in comparison_donors
        for region in ("Cx", "HC")
        for preparation in ("Fresh", "Form", "FFPE")
        for biological in (1, 2, 3)
        for technical in (1, 2)
    }


def _source_missingness(
    runs: list[RunRecord],
    donors: dict[str, int],
    artifacts: list[ArtifactRecord],
) -> dict[str, object]:
    present = {
        (
            run.body_donor_number,
            run.brain_region_token,
            run.preparation_token,
            run.biological_replicate,
            run.technical_replicate,
        )
        for run in runs
    }
    missing = sorted(_expected_comparison_runs(donors) - present)
    return {
        "schema_version": "1.0.0",
        "product_id": "proteomexchange-pxd064700-revision-1",
        "submission_type": "PARTIAL",
        "repository_support": "Unsupported dataset by repository",
        "comparison_design_expected_run_count": 216,
        "comparison_design_present_run_count": 216 - len(missing),
        "comparison_design_missing_runs": [
            {
                "body_donor_number": donor,
                "brain_region_token": region,
                "preparation_token": preparation,
                "biological_replicate": biological,
                "technical_replicate": technical,
                "reason": "Absent from the revision 1 FTP listing; no value was synthesized.",
            }
            for donor, region, preparation, biological, technical in missing
        ],
        "raw_runs_without_quant_sidecar": [],
        "raw_runs_without_sdrf_row": [],
        "checksummed_artifact_count": sum(item.sha1 is not None for item in artifacts),
        "artifacts_missing_publisher_checksum": [
            {
                "artifact_ref": item.artifact_ref,
                "file_name": item.file_name,
                "reason": item.missing_checksum_reason,
            }
            for item in artifacts
            if item.sha1 is None
        ],
        "artifacts_missing_from_ftp_listing": [],
        "checksum_basenames_missing_from_ftp_listing": [],
        "community_sdrf_missing_from_revision_1_announcement": True,
        "standardized_identification_result_claimed": False,
        "standardized_identification_gap_reason": (
            "PRIDE publishes this record as a PARTIAL submission and ProteomeXchange marks it "
            "unsupported by the repository. The product retains the submitted DIA-NN search "
            "outputs "
            "without treating them as a complete standardized identification submission."
        ),
    }


def _source_context(
    contract: SourceContract,
    project: dict[str, Any],
    manifest: SnapshotManifest,
) -> dict[str, object]:
    return {
        "schema_version": "1.0.0",
        "product_id": contract.product_id,
        "retrieved_at": manifest.retrieved_at,
        "dataset": contract.dataset.model_dump(mode="json"),
        "rights": contract.rights.model_dump(mode="json"),
        "assay": contract.assay.model_dump(mode="json"),
        "study_context": contract.study_context.model_dump(mode="json"),
        "preparations": [item.model_dump(mode="json") for item in contract.preparations],
        "sample_processing_protocol": project["sampleProcessingProtocol"],
        "data_processing_protocol": project["dataProcessingProtocol"],
        "published_findings_not_recomputed": {
            "shared_core_proteins": 1753,
            "fresh_frozen_exclusive_proteins": 35,
            "braak_pilot_potential_biomarkers": 12,
        },
        "source_boundaries": contract.source_boundaries.model_dump(mode="json"),
        "sdrf_provenance": (
            "PRIDE community annotation added after revision 1; the PRIDE project page says the "
            "submitter has not verified it. Native columns are retained on run records."
        ),
    }


def publish_product(root: Path = PROJECT_DIR) -> dict[str, object]:
    contract = SourceContract.model_validate(_read_object(root / "contracts/source.json"))
    manifest = SnapshotManifest.model_validate(
        _read_object(root / "snapshots/snapshot-manifest.json")
    )
    if manifest.product_id != contract.product_id:
        raise ProductError("snapshot and source contract product identifiers differ")
    _verify_snapshots(root, manifest)
    project = _read_object(root / "snapshots/pride-project.json")
    if project.get("accession") != contract.dataset.accession:
        raise ProductError("PRIDE project accession differs from the source contract")
    if project.get("submissionType") != contract.dataset.submission_type:
        raise ProductError("PRIDE submission type differs from the source contract")
    if project.get("license") != contract.rights.dataset_license:
        raise ProductError("PRIDE rights statement differs from the source contract")

    ftp_entries = read_ftp_entries(root / "snapshots/ftp-listing.jsonl")
    announced = announcement_files(root / "snapshots/proteomexchange-announcement.xml")
    checksums = _checksums(root / "snapshots/checksum.txt")
    artifacts = _artifacts(ftp_entries, announced, checksums)
    sdrf = _sdrf_rows(root / "snapshots/community-annotation.sdrf.tsv")
    donors = _donor_map(root / "snapshots/donor-name-map.tsv")
    runs = _runs(contract, artifacts, sdrf, donors)
    pairings = _pairings(contract, runs)
    missingness = _source_missingness(runs, donors, artifacts)

    output_root = root / "outputs"
    write_jsonl(
        output_root / "artifact-index.jsonl",
        [item.model_dump(mode="json") for item in artifacts],
    )
    write_jsonl(
        output_root / "run-index.jsonl",
        [item.model_dump(mode="json") for item in runs],
    )
    write_jsonl(
        output_root / "pairing-index.jsonl",
        [item.model_dump(mode="json") for item in pairings],
    )
    write_json(
        output_root / "publisher-roles.json",
        {
            "schema_version": "1.0.0",
            "product_id": contract.product_id,
            "roles": [item.model_dump(mode="json") for item in contract.publisher_roles],
        },
    )
    write_json(output_root / "source-missingness.json", missingness)
    write_json(output_root / "source-context.json", _source_context(contract, project, manifest))

    artifacts_by_category = Counter(
        item.announcement_category or "not_in_revision_1_announcement" for item in artifacts
    )
    artifacts_by_role = Counter(item.native_artifact_role for item in artifacts)
    runs_by_preparation = Counter(item.preparation_token for item in runs)
    total_bytes = sum(item.bytes for item in artifacts)
    metrics: dict[str, object] = {
        "product_id": contract.product_id,
        "artifact_count": len(artifacts),
        "announced_artifact_count": len(announced),
        "checksummed_artifact_count": len(checksums),
        "total_listed_bytes": total_bytes,
        "total_listed_gib": round(total_bytes / (1024**3), 6),
        "artifacts_by_announcement_category": dict(sorted(artifacts_by_category.items())),
        "artifacts_by_native_role": dict(sorted(artifacts_by_role.items())),
        "run_count": len(runs),
        "quant_sidecar_count": sum(item.file_name.endswith(".raw.quant") for item in artifacts),
        "runs_by_preparation": dict(sorted(runs_by_preparation.items())),
        "donor_count": len(donors),
        "pairing_unit_count": len(pairings),
        "comparison_design_missing_run_count": len(
            cast(list[dict[str, object]], missingness["comparison_design_missing_runs"])
        ),
        "files_with_naming_variants": sum(bool(item.file_naming_variants) for item in runs),
    }
    write_json(output_root / "metrics.json", metrics)
    return metrics
