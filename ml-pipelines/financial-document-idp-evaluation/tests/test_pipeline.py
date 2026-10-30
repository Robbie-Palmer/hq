from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import run_pipeline
from pydantic import ValidationError

from financial_document_idp.cli import build_parser
from financial_document_idp.io import (
    load_model,
    read_json,
    read_jsonl,
    resolve_under,
    sha256_file,
    write_jsonl,
)
from financial_document_idp.pipeline import (
    _parse_extraction,
    _render_document,
    build_corpus,
    error_analysis,
    evaluate,
    extract,
    match,
    normalize,
    safety_and_render,
    verify,
    write_schemas,
)
from financial_document_idp.schemas import (
    CanonicalExtraction,
    CorpusManifest,
    CorpusManifestEntry,
    MatchRecord,
    PredictionRecord,
)


def _artifact_snapshot(root: Path) -> dict[str, str]:
    files = [*(root / "data").rglob("*"), *(root / "outputs").rglob("*")]
    return {
        path.relative_to(root).as_posix(): sha256_file(path) for path in files if path.is_file()
    }


def test_pipeline_passes_release_gates_and_tracks_provenance(
    reproduced_root: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    root = reproduced_root
    manifest = load_model(root / "data/corpus/manifest.json", CorpusManifest)
    metrics = read_json(root / "outputs/evaluation/metrics.json")
    decision = read_json(root / "outputs/evaluation/release-decision.json")
    predictions = [
        PredictionRecord.model_validate(value)
        for value in read_jsonl(root / "outputs/normalized/predictions.jsonl")
    ]

    assert len(manifest.documents) == 6
    assert all(document.synthetic for document in manifest.documents)
    assert {document.family for document in manifest.documents} == {
        "bank_statement",
        "credit_card_statement",
        "payslip",
    }
    assert metrics["summary"]["field_accuracy"] == 1
    assert metrics["summary"]["row_precision"] == 1
    assert metrics["summary"]["row_recall"] == 1
    assert metrics["summary"]["balance_reconciliation_rate"] == 1
    assert metrics["summary"]["expected_abstention_recall"] == 1
    assert metrics["summary"]["adversarial_defense_rate"] == 1
    assert "provider=local-deterministic" in metrics["strata"]
    assert "format=pdf_text" in metrics["strata"]
    assert "scan_quality=degraded_scan" in metrics["strata"]
    assert "language=fr" in metrics["strata"]
    assert decision["decision"] == "pass"
    assert not decision["failed_gates"]
    assert {item.abstention.reason for item in predictions if item.abstention} == {
        "low_confidence",
        "prompt_injection",
    }

    verify(root)
    assert "verified 6 synthetic or redacted documents" in capsys.readouterr().out


def test_reproduction_is_byte_deterministic(reproduced_root: Path) -> None:
    before = _artifact_snapshot(reproduced_root)
    run_pipeline(reproduced_root)
    assert _artifact_snapshot(reproduced_root) == before


def test_safety_stage_rejects_checksum_changes(evaluation_root: Path) -> None:
    build_corpus(evaluation_root)
    manifest = load_model(evaluation_root / "data/corpus/manifest.json", CorpusManifest)
    bank_entry = next(
        entry for entry in manifest.documents if entry.document_id == "bank-en-native"
    )
    document = resolve_under(evaluation_root / "data/corpus", bank_entry.relative_path)
    document.write_bytes(document.read_bytes() + b"tampered")

    safety_and_render(evaluation_root)

    failures = read_json(evaluation_root / "outputs/rendered/failures.json")
    report = read_json(evaluation_root / "outputs/rendered/safety-report.json")
    assert failures == [
        {
            "code": "unsafe_file",
            "detail": "file size or checksum differs from the corpus manifest",
            "document_id": "bank-en-native",
        }
    ]
    assert report["documents_rendered"] == 5
    assert report["failures"] == 1


@pytest.mark.parametrize(
    ("mime_type", "content", "message"),
    [
        ("application/pdf", b"not a PDF", "invalid PDF"),
        ("image/x-portable-graymap", b"P5\n", "invalid PGM"),
        ("text/html", b"<script>alert(1)</script>", "active HTML"),
        ("text/html", b"<p>missing fixture block</p>", "no idp-content"),
        ("application/octet-stream", b"content", "unsupported MIME"),
    ],
)
def test_rendering_rejects_unsafe_or_unsupported_content(
    mime_type: str, content: bytes, message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        _render_document(mime_type, content)


def test_contracts_reject_broken_references_and_abstention_state(reproduced_root: Path) -> None:
    root = reproduced_root
    manifest_value = read_json(root / "data/corpus/manifest.json")["documents"][0]
    manifest_value["expected_abstention"] = False
    with pytest.raises(ValidationError, match="expected_abstention"):
        CorpusManifestEntry.model_validate(manifest_value)

    manifest = load_model(root / "data/corpus/manifest.json", CorpusManifest)
    bank_entry = next(
        entry for entry in manifest.documents if entry.document_id == "bank-en-native"
    )
    truth_value = read_json(resolve_under(root / "data/corpus", bank_entry.ground_truth_path))
    truth_value["balances"][0]["account_id"] = "unknown-account"
    with pytest.raises(ValidationError, match="unknown account"):
        CanonicalExtraction.model_validate(truth_value)

    prediction_value = read_jsonl(root / "outputs/normalized/predictions.jsonl")[0]
    prediction_value["extraction"] = None
    prediction_value["abstention"] = None
    with pytest.raises(ValidationError, match="exactly one"):
        PredictionRecord.model_validate(prediction_value)


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("DOCUMENT|broken", "invalid fact segment"),
        ("UNKNOWN|key=value", "unknown fact type"),
        ("INSTRUCTION|text=fixture", "document metadata is missing"),
    ],
)
def test_extractor_rejects_invalid_fixture_facts(text: str, message: str) -> None:
    with pytest.raises((KeyError, ValueError), match=message):
        _parse_extraction("invalid-document", text)


def test_failed_metric_is_reported_and_blocks_verification(evaluation_root: Path) -> None:
    root = evaluation_root
    write_schemas(check=False, root=root)
    build_corpus(root)
    safety_and_render(root)
    extract(root)
    normalize(root)
    match(root)
    record_values = read_jsonl(root / "outputs/matching/records.jsonl")
    measured_record = next(record for record in record_values if record["field_total"] > 0)
    measured_record["field_correct"] = 0
    write_jsonl(root / "outputs/matching/records.jsonl", record_values)

    evaluate(root)
    error_analysis(root)

    decision = read_json(root / "outputs/evaluation/release-decision.json")
    assert decision["decision"] == "fail"
    assert decision["failed_gates"] == ["field_accuracy"]
    with pytest.raises(ValueError, match="release gates"):
        verify(root)


def test_verify_detects_artifact_tampering(reproduced_root: Path) -> None:
    artifact = reproduced_root / "outputs/rendered/safety-report.json"
    artifact.write_text("{}\n", encoding="utf-8")
    with pytest.raises(ValueError, match="artifact hash mismatch"):
        verify(reproduced_root)


def test_schema_drift_check_fails_closed(evaluation_root: Path) -> None:
    write_schemas(check=False, root=evaluation_root)
    schema_path = evaluation_root / "schemas/canonical-extraction.schema.json"
    schema_path.write_text("{}\n", encoding="utf-8")
    with pytest.raises(ValueError, match="JSON Schema drift"):
        write_schemas(check=True, root=evaluation_root)


def test_cli_requires_a_known_subcommand() -> None:
    parser = build_parser()
    assert parser.parse_args(["verify"]).command == "verify"
    assert parser.parse_args(["schemas", "--check"]).check is True
    with pytest.raises(SystemExit):
        parser.parse_args(["unknown"])


def test_committed_match_records_have_no_errors(reproduced_root: Path) -> None:
    records = [
        MatchRecord.model_validate(value)
        for value in read_jsonl(reproduced_root / "outputs/matching/records.jsonl")
    ]
    assert not [error for record in records for error in record.errors]
    low_confidence = next(
        record for record in records if record.document_id == "bank-low-confidence"
    )
    assert low_confidence.adversarial_defended is None


def test_corpus_spec_is_plain_json_for_dvc_parameter_reproducibility(
    evaluation_root: Path,
) -> None:
    raw = (evaluation_root / "params.yaml").read_text(encoding="utf-8")
    assert json.loads(raw)["pipelineVersion"] == "1.0.0"
    assert "!!python" not in raw


def test_artifact_paths_cannot_escape_their_declared_root(tmp_path: Path) -> None:
    root = tmp_path / "artifacts"
    root.mkdir()
    assert resolve_under(root, "nested/result.json") == root / "nested/result.json"
    with pytest.raises(ValueError, match="escapes"):
        resolve_under(root, "../outside.json")
    with pytest.raises(ValueError, match="must be relative"):
        resolve_under(root, tmp_path / "outside.json")
