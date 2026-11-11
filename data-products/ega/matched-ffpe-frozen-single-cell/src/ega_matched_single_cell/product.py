from __future__ import annotations

import json
import re
import urllib.request
from collections import Counter
from collections.abc import Sequence
from http.client import HTTPMessage
from pathlib import Path
from typing import IO, Literal, Protocol, cast, override
from urllib.parse import urlsplit

from ega_matched_single_cell.models import (
    Dac,
    Dataset,
    Experiment,
    FileRecord,
    Inventory,
    PairRecord,
    Policy,
    Run,
    Sample,
    SourceContract,
    Study,
)

PROJECT_DIR = Path(__file__).resolve().parents[2]
PUBLIC_API_ORIGIN = "https://metadata.ega-archive.org"
FIXTURE_ENDPOINTS = {
    "dataset.json": "/datasets/EGAD00001015781",
    "studies.json": "/datasets/EGAD00001015781/studies",
    "dacs.json": "/datasets/EGAD00001015781/dacs",
    "policy.json": "/policies/EGAP00001000045",
    "samples.json": "/datasets/EGAD00001015781/samples",
    "experiments.json": "/datasets/EGAD00001015781/experiments",
    "runs.json": "/datasets/EGAD00001015781/runs",
    "files.json": "/datasets/EGAD00001015781/files",
}
SAMPLE_TITLE = re.compile(
    r"^POG sample (?P<label>(?P<patient>\d+)(?P<ffpe>_FFPE)?-"
    r"(?P<preparation>FF|OCT)-(?P<biopsy>\d+)) from patient (?P=patient)$"
)


class ProductError(RuntimeError):
    pass


class _HasAccession(Protocol):
    @property
    def accession_id(self) -> str: ...


def _read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def _read_list(path: Path) -> list[object]:
    value = _read_json(path)
    if not isinstance(value, list):
        raise ProductError(f"{path} must contain a JSON array")
    return cast("list[object]", value)


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _fixtures(root: Path) -> Path:
    return root / "tests/fixtures/ega-public-metadata"


def _unique_accessions(records: Sequence[_HasAccession], kind: str) -> None:
    accessions = [record.accession_id for record in records]
    if len(accessions) != len(set(accessions)):
        raise ProductError(f"duplicate {kind} accession")


def _sample_pairs(samples: list[Sample]) -> list[PairRecord]:
    grouped: dict[str, dict[str, Sample]] = {}
    parsed: dict[str, re.Match[str]] = {}
    for sample in samples:
        match = SAMPLE_TITLE.fullmatch(sample.title)
        if match is None:
            raise ProductError(
                f"sample title does not preserve the publisher pairing: {sample.title}"
            )
        if f"sample {match['label']} from patient {match['patient']}" not in sample.description:
            raise ProductError(
                f"sample description differs from its publisher title: {sample.accession_id}"
            )
        pair_label = f"{match['patient']}-{match['preparation']}-{match['biopsy']}"
        role = "ffpe" if match["ffpe"] else "frozen"
        if role in grouped.setdefault(pair_label, {}):
            raise ProductError(f"duplicate {role} sample for {pair_label}")
        grouped[pair_label][role] = sample
        parsed[pair_label] = match

    pairs: list[PairRecord] = []
    for pair_label, members in sorted(grouped.items()):
        if set(members) != {"ffpe", "frozen"}:
            raise ProductError(f"incomplete publisher sample pair: {pair_label}")
        match = parsed[pair_label]
        frozen = members["frozen"]
        ffpe = members["ffpe"]
        if frozen.subject_id is None or frozen.subject_id != match["patient"]:
            raise ProductError(f"subject-id missingness changed for {pair_label}")
        if ffpe.subject_id is not None:
            raise ProductError(f"subject-id missingness changed for {pair_label}")
        if frozen.phenotype != ffpe.phenotype:
            raise ProductError(f"phenotype differs inside publisher sample pair: {pair_label}")
        pairs.append(
            PairRecord(
                publisher_pair_label=pair_label,
                publisher_patient_label=match["patient"],
                publisher_biopsy_label=match["biopsy"],
                frozen_preparation_code=cast("Literal['FF', 'OCT']", match["preparation"]),
                frozen_sample_accession=frozen.accession_id,
                ffpe_sample_accession=ffpe.accession_id,
                frozen_subject_id=frozen.subject_id,
                ffpe_subject_id=ffpe.subject_id,
                relationship_evidence="EGA sample titles and paper matched-pair design",
            )
        )
    return pairs


def _validate_repository_counts(
    contract: SourceContract,
    dataset: Dataset,
    samples: list[Sample],
    experiments: list[Experiment],
    runs: list[Run],
    files: list[FileRecord],
    pairs: list[PairRecord],
) -> None:
    if dataset.released_date.date().isoformat() != "2025-11-21":
        raise ProductError("EGA dataset release date changed")
    if dataset.num_samples != contract.portal.displayed_sample_count:
        raise ProductError("portal sample display differs from the source contract")
    if len(samples) != 24 or len(pairs) != contract.paper.cohort.matched_pair_count:
        raise ProductError("public sample objects no longer form the paper's 12 pairs")
    if len({pair.publisher_patient_label for pair in pairs}) != contract.paper.cohort.patient_count:
        raise ProductError("publisher sample pairs no longer cover seven patients")
    if len(experiments) != 35 or len(runs) != 107:
        raise ProductError("EGA experiment or run count changed")
    if len(files) != contract.portal.file_count:
        raise ProductError("EGA file count changed")
    if sum(file.filesize for file in files) != contract.portal.total_bytes:
        raise ProductError("EGA file bytes changed")
    if {file.unencrypted_checksum_type for file in files} != {"MD5"}:
        raise ProductError("EGA checksum type changed")
    if {location for file in files for location in file.locations} != {"crg", "ebi"}:
        raise ProductError("EGA file locations changed")


def build_product(root: Path = PROJECT_DIR) -> dict[str, object]:
    fixtures = _fixtures(root)
    contract = SourceContract.model_validate(_read_json(root / "contracts/source-product.json"))
    dataset = Dataset.model_validate(_read_json(fixtures / "dataset.json"))
    studies = [Study.model_validate(value) for value in _read_list(fixtures / "studies.json")]
    dacs = [Dac.model_validate(value) for value in _read_list(fixtures / "dacs.json")]
    policy = Policy.model_validate(_read_json(fixtures / "policy.json"))
    samples = [Sample.model_validate(value) for value in _read_list(fixtures / "samples.json")]
    experiments = [
        Experiment.model_validate(value) for value in _read_list(fixtures / "experiments.json")
    ]
    runs = [Run.model_validate(value) for value in _read_list(fixtures / "runs.json")]
    files = [FileRecord.model_validate(value) for value in _read_list(fixtures / "files.json")]
    for records, kind in (
        (studies, "study"),
        (dacs, "DAC"),
        (samples, "sample"),
        (experiments, "experiment"),
        (runs, "run"),
        (files, "file"),
    ):
        _unique_accessions(records, kind)

    if len(studies) != 1 or len(dacs) != 1:
        raise ProductError("dataset must retain one study and one DAC")
    if policy.dac_accession_id != dacs[0].accession_id:
        raise ProductError("policy and DAC accessions differ")
    if set(policy.duos) != {term.identifier for term in contract.duo_terms}:
        raise ProductError("policy DUO terms differ from the source contract")

    pairs = _sample_pairs(samples)
    _validate_repository_counts(contract, dataset, samples, experiments, runs, files, pairs)
    sample_accessions = {sample.accession_id for sample in samples}
    run_sample_accessions = {run.sample_accession_id for run in runs}
    unknown_run_samples = run_sample_accessions - sample_accessions
    if unknown_run_samples:
        raise ProductError(f"runs refer to unknown public samples: {sorted(unknown_run_samples)}")
    samples_without_public_runs = sorted(sample_accessions - run_sample_accessions)
    if samples_without_public_runs != ["EGAN00004810945"]:
        raise ProductError("public run-to-sample missingness changed")

    missingness: dict[str, object] = {
        "dataset_types": dataset.dataset_types,
        "ffpe_sample_subject_id_null_count": sum(sample.subject_id is None for sample in samples),
        "public_sample_record_count": len(samples),
        "portal_displayed_sample_count": dataset.num_samples,
        "paper_matched_pair_count": contract.paper.cohort.matched_pair_count,
        "samples_without_public_runs": samples_without_public_runs,
        "sample_file_mapping": "not public; EGA requires an approved accessor",
        "file_names": "not present in the public file response",
        "payload": "not downloaded; controlled access",
        "repository_redistribution_license": None,
        "unsupported_evidence": contract.absent_evidence,
    }
    inventory = Inventory(
        schema_version="1.0.0",
        product_id=contract.product_id,
        dataset=dataset,
        studies=studies,
        dacs=dacs,
        policy=policy,
        sample_pairs=pairs,
        samples=samples,
        experiments=experiments,
        runs=runs,
        files=files,
        evidence=contract,
        missingness=missingness,
    )
    metrics: dict[str, object] = {
        "controlled_payload_download_count": 0,
        "experiment_count": len(experiments),
        "file_count": len(files),
        "file_total_bytes": sum(file.filesize for file in files),
        "paper_patient_count": contract.paper.cohort.patient_count,
        "paper_specimen_pair_count": len(pairs),
        "portal_displayed_sample_count": dataset.num_samples,
        "public_sample_record_count": len(samples),
        "run_count": len(runs),
        "checksum_counts": dict(Counter(file.unencrypted_checksum_type for file in files)),
        "experiment_model_counts": dict(Counter(item.model for item in experiments)),
        "experiment_strategy_counts": dict(Counter(item.library_strategy for item in experiments)),
    }
    _write_json(root / "outputs/source-inventory.json", inventory.model_dump(mode="json"))
    _write_json(root / "outputs/metrics.json", metrics)
    return metrics


def _normalize(value: object) -> object:
    if isinstance(value, dict):
        items = cast("dict[str, object]", value)
        return {key: _normalize(item) for key, item in sorted(items.items())}
    if isinstance(value, list):
        normalized = [_normalize(item) for item in value]
        if all(isinstance(item, dict) and "accession_id" in item for item in normalized):
            records = cast("list[dict[str, object]]", normalized)
            return sorted(records, key=lambda item: str(item["accession_id"]))
        if all(isinstance(item, dict) and "email" in item for item in normalized):
            contacts = cast("list[dict[str, object]]", normalized)
            return sorted(contacts, key=lambda item: str(item["email"]))
        if all(isinstance(item, str) for item in normalized):
            return sorted(cast("list[str]", normalized))
        return normalized
    return value


class _PublicMetadataRedirectHandler(urllib.request.HTTPRedirectHandler):
    @override
    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: IO[bytes],
        code: int,
        msg: str,
        headers: HTTPMessage,
        newurl: str,
    ) -> urllib.request.Request | None:
        target = urlsplit(newurl)
        if target.scheme != "https" or target.netloc != "metadata.ega-archive.org":
            raise ProductError("public metadata redirect left the allowlisted EGA origin")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _fetch_public_json(endpoint: str) -> object:
    if not endpoint.startswith("/") or "?" in endpoint or "#" in endpoint:
        raise ProductError("public metadata endpoint must be an absolute path without parameters")
    url = f"{PUBLIC_API_ORIGIN}{endpoint}"
    request = urllib.request.Request(  # noqa: S310 - fixed HTTPS origin and allowlisted paths.
        url,
        headers={"Accept": "application/json", "User-Agent": "ega-source-product-drift/0.1"},
    )
    opener = urllib.request.build_opener(_PublicMetadataRedirectHandler())
    with opener.open(request, timeout=30) as response:
        if response.geturl() != url:
            raise ProductError("public metadata response URL changed")
        return json.load(response)


def check_public_drift(root: Path = PROJECT_DIR) -> dict[str, str]:
    fixtures = _fixtures(root)
    drift: dict[str, str] = {}
    for fixture_name, endpoint in FIXTURE_ENDPOINTS.items():
        expected = _normalize(_read_json(fixtures / fixture_name))
        observed = _normalize(_fetch_public_json(endpoint))
        if observed != expected:
            drift[fixture_name] = endpoint
    if drift:
        names = ", ".join(sorted(drift))
        raise ProductError(f"public EGA metadata drift detected: {names}")
    return dict(sorted(FIXTURE_ENDPOINTS.items()))
