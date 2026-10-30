"""Deterministic stages for the financial-document evaluation DAG."""

from __future__ import annotations

import base64
import html
import math
import shutil
from collections import Counter, defaultdict
from collections.abc import Iterable
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, cast, override

from .io import (
    canonical_bytes,
    code_revision,
    load_model,
    load_params,
    pretty_bytes,
    project_root,
    read_json,
    read_jsonl,
    sha256_bytes,
    sha256_file,
    write_json,
    write_jsonl,
)
from .schemas import (
    Abstention,
    Account,
    AccountType,
    Balance,
    BalanceKind,
    CanonicalExtraction,
    CorpusManifest,
    CorpusManifestEntry,
    CorpusSpec,
    DocumentFamily,
    DocumentMetadata,
    MatchRecord,
    Money,
    Period,
    PredictionRecord,
    RenderedDocument,
    Transaction,
)

PROMPT_INJECTION_SIGNALS = (
    "ignore previous",
    "reveal the system prompt",
    "tool call",
    "exfiltrate",
)
MIME_EXTENSIONS = {
    "application/pdf": ".pdf",
    "text/html": ".html",
    "image/x-portable-graymap": ".pgm",
}


def _reset_directory(path: Path, root: Path) -> None:
    path.resolve().relative_to(root.resolve())
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True)


def _chunked_base64(content: str, prefix: bytes) -> bytes:
    encoded = base64.b64encode(content.encode())
    chunks = [encoded[index : index + 72] for index in range(0, len(encoded), 72)]
    return b"".join(prefix + chunk + b"\n" for chunk in chunks)


def _pdf_fixture(content: str) -> bytes:
    marker = b"%IDP_TEXT_BEGIN\n" + _chunked_base64(content, b"%") + b"%IDP_TEXT_END\n"
    stream = b"BT /F1 10 Tf 72 720 Td (Synthetic financial fixture) Tj ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    body = b"%PDF-1.4\n% synthetic-only\n" + marker
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(body))
        body += f"{index} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref_offset = len(body)
    xref = f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    xref += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
    trailer = (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n"
    ).encode()
    return body + xref + trailer


def _html_fixture(content: str) -> bytes:
    document = (
        '<!doctype html>\n<html lang="en"><meta charset="utf-8">'
        "<title>Synthetic financial fixture</title>"
        f'<pre id="idp-content">{html.escape(content)}</pre></html>\n'
    )
    return document.encode()


def _pgm_fixture(content: str) -> bytes:
    return (
        b"P2\n# Synthetic financial fixture\n#IDP_TEXT_BEGIN\n"
        + _chunked_base64(content, b"#")
        + b"#IDP_TEXT_END\n4 4\n255\n0 64 128 255\n64 128 255 0\n128 255 0 64\n255 0 64 128\n"
    )


def _encode_fixture(mime_type: str, content: str) -> bytes:
    if mime_type == "application/pdf":
        return _pdf_fixture(content)
    if mime_type == "text/html":
        return _html_fixture(content)
    if mime_type == "image/x-portable-graymap":
        return _pgm_fixture(content)
    raise ValueError(f"unsupported fixture MIME type: {mime_type}")


def build_corpus(root: Path | None = None) -> None:
    root = root or project_root()
    params = load_params(root)
    spec = load_model(root / str(params["corpusSpec"]), CorpusSpec)
    corpus_dir = root / "data/corpus"
    _reset_directory(corpus_dir, root)
    documents_dir = corpus_dir / "documents"
    truth_dir = corpus_dir / "ground-truth"
    documents_dir.mkdir()
    truth_dir.mkdir()
    entries: list[CorpusManifestEntry] = []
    for document in sorted(spec.documents, key=lambda item: item.document_id):
        content = _encode_fixture(document.mime_type, document.content)
        document_path = documents_dir / document.filename
        document_path.write_bytes(content)
        truth_path = truth_dir / f"{document.document_id}.json"
        write_json(truth_path, document.ground_truth)
        entries.append(
            CorpusManifestEntry(
                document_id=document.document_id,
                family=document.family,
                relative_path=f"documents/{document.filename}",
                mime_type=document.mime_type,
                sha256=sha256_bytes(content),
                byte_size=len(content),
                source_rights=document.source_rights,
                consent_or_generation_method=document.consent_or_generation_method,
                redaction_status=document.redaction_status,
                synthetic=document.synthetic,
                strata=document.strata,
                ground_truth_path=f"ground-truth/{document.document_id}.json",
                expected_abstention=document.expected_abstention,
                expected_abstention_reason=document.expected_abstention_reason,
                adversarial_tags=document.adversarial_tags,
            )
        )
    manifest = CorpusManifest(
        schema_version="1.0.0",
        corpus_version=spec.corpus_version,
        generated_at=spec.generated_at,
        privacy_policy="synthetic_or_strongly_redacted_only",
        documents=entries,
    )
    write_json(corpus_dir / "manifest.json", manifest)


class _FixtureHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.capture = False
        self.parts: list[str] = []

    @override
    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "pre" and dict(attrs).get("id") == "idp-content":
            self.capture = True

    @override
    def handle_endtag(self, tag: str) -> None:
        if tag == "pre":
            self.capture = False

    @override
    def handle_data(self, data: str) -> None:
        if self.capture:
            self.parts.append(data)


def _decode_marker(content: bytes, prefix: bytes) -> str:
    lines = content.splitlines()
    start = lines.index(prefix + b"IDP_TEXT_BEGIN")
    end = lines.index(prefix + b"IDP_TEXT_END")
    encoded = b"".join(line.removeprefix(prefix) for line in lines[start + 1 : end])
    return base64.b64decode(encoded, validate=True).decode()


def _render_document(mime_type: str, content: bytes) -> str:
    if mime_type == "application/pdf":
        if not content.startswith(b"%PDF-1.4") or not content.rstrip().endswith(b"%%EOF"):
            raise ValueError("invalid PDF signature or trailer")
        return _decode_marker(content, b"%")
    if mime_type == "image/x-portable-graymap":
        if not content.startswith(b"P2\n"):
            raise ValueError("invalid PGM signature")
        return _decode_marker(content, b"#")
    if mime_type == "text/html":
        decoded = content.decode()
        folded = decoded.casefold()
        if "<script" in folded or "javascript:" in folded:
            raise ValueError("active HTML content is not allowed")
        parser = _FixtureHtmlParser()
        parser.feed(decoded)
        if not parser.parts:
            raise ValueError("HTML fixture has no idp-content block")
        return "".join(parser.parts)
    raise ValueError(f"unsupported MIME type: {mime_type}")


def safety_and_render(root: Path | None = None) -> None:
    root = root or project_root()
    params = load_params(root)
    corpus_dir = root / "data/corpus"
    manifest = load_model(corpus_dir / "manifest.json", CorpusManifest)
    output_dir = root / "outputs/rendered"
    _reset_directory(output_dir, root)
    allowed = set(params["fileSafety"]["allowedMimeTypes"])
    max_bytes = int(params["fileSafety"]["maxBytes"])
    rendered: list[RenderedDocument] = []
    failures: list[dict[str, str]] = []
    format_counts: Counter[str] = Counter()
    for entry in manifest.documents:
        path = corpus_dir / entry.relative_path
        try:
            content = path.read_bytes()
            if entry.mime_type not in allowed:
                raise ValueError("MIME type is not allowlisted")
            if path.suffix != MIME_EXTENSIONS[entry.mime_type]:
                raise ValueError("file extension does not match the declared MIME type")
            if len(content) > max_bytes:
                raise ValueError("file exceeds the configured byte limit")
            if len(content) != entry.byte_size or sha256_bytes(content) != entry.sha256:
                raise ValueError("file size or checksum differs from the corpus manifest")
            text = _render_document(entry.mime_type, content)
            signals = [signal for signal in PROMPT_INJECTION_SIGNALS if signal in text.casefold()]
            rendered.append(
                RenderedDocument(
                    document_id=entry.document_id,
                    text=text,
                    sha256=entry.sha256,
                    prompt_injection_detected=bool(signals),
                    prompt_injection_signals=signals,
                )
            )
            format_counts[entry.strata.document_format] += 1
        except (OSError, UnicodeError, ValueError) as error:
            failures.append(
                {"document_id": entry.document_id, "code": "unsafe_file", "detail": str(error)}
            )
    write_jsonl(output_dir / "documents.jsonl", rendered)
    write_json(output_dir / "failures.json", failures)
    write_json(
        output_dir / "safety-report.json",
        {
            "schema_version": "1.0.0",
            "documents_checked": len(manifest.documents),
            "documents_rendered": len(rendered),
            "failures": len(failures),
            "prompt_injection_documents": sum(item.prompt_injection_detected for item in rendered),
            "formats": dict(sorted(format_counts.items())),
        },
    )


def _parse_parts(line: str) -> tuple[str, dict[str, str]]:
    parts = line.split("|")
    values: dict[str, str] = {}
    for part in parts[1:]:
        key, separator, value = part.partition("=")
        if not separator or not key or not value:
            raise ValueError(f"invalid fact segment: {part}")
        values[key] = value
    return parts[0], values


def _money(values: dict[str, str]) -> Money:
    return Money(minor_units=int(values["minor_units"]), currency=values["currency"].upper())


def _parse_extraction(document_id: str, text: str) -> tuple[CanonicalExtraction, float]:
    family: DocumentFamily | None = None
    metadata: DocumentMetadata | None = None
    accounts: list[Account] = []
    periods: list[Period] = []
    balances: list[Balance] = []
    transactions: list[Transaction] = []
    for line in text.splitlines():
        if not line or line.startswith("INSTRUCTION|"):
            continue
        kind, values = _parse_parts(line)
        if kind == "DOCUMENT":
            family = DocumentFamily(values["family"])
            metadata = DocumentMetadata(
                issued_date=values["issued_date"],
                page_count=int(values["page_count"]),
                language=values["language"],
                source_format=values["source_format"],
            )
        elif kind == "ACCOUNT":
            accounts.append(
                Account(
                    account_id=values["account_id"],
                    account_type=cast(AccountType, values["account_type"]),
                    display_name=values["display_name"],
                    currency=values["currency"].upper(),
                )
            )
        elif kind == "PERIOD":
            periods.append(
                Period(
                    period_id=values["period_id"],
                    start_date=values["start_date"],
                    end_date=values["end_date"],
                )
            )
        elif kind == "BALANCE":
            balances.append(
                Balance(
                    balance_id=values["balance_id"],
                    account_id=values["account_id"],
                    period_id=values["period_id"],
                    kind=cast(BalanceKind, values["kind"]),
                    amount=_money(values),
                )
            )
        elif kind == "TRANSACTION":
            transactions.append(
                Transaction(
                    transaction_id=values["transaction_id"],
                    account_id=values["account_id"],
                    period_id=values["period_id"],
                    posted_date=values["posted_date"],
                    description=values["description"],
                    amount=_money(values),
                )
            )
        else:
            raise ValueError(f"unknown fact type: {kind}")
    if family is None or metadata is None:
        raise ValueError("document metadata is missing")
    currencies = sorted(
        {
            *(account.currency for account in accounts),
            *(balance.amount.currency for balance in balances),
            *(transaction.amount.currency for transaction in transactions),
        }
    )
    extraction = CanonicalExtraction(
        schema_version="1.0.0",
        document_id=document_id,
        family=family,
        metadata=metadata,
        accounts=accounts,
        periods=periods,
        balances=balances,
        transactions=transactions,
        currencies=currencies,
    )
    balance_kinds = {balance.kind for balance in balances}
    confidence = 1.0 if {"opening", "closing"}.issubset(balance_kinds) else 0.6
    return extraction, confidence


def _operational_metrics(text: str, params: dict[str, Any]) -> tuple[int, int]:
    config = params["extraction"]
    byte_blocks = math.ceil(len(text.encode()) / 100)
    latency_ms = int(config["baseLatencyMs"]) + byte_blocks * int(config["latencyMsPer100Bytes"])
    character_blocks = math.ceil(len(text) / 1000)
    cost_microusd = character_blocks * int(config["costMicrousdPer1000Characters"])
    return latency_ms, cost_microusd


def extract(root: Path | None = None) -> None:
    root = root or project_root()
    params = load_params(root)
    model_manifest = read_json(root / str(params["modelManifest"]))
    prompt_path = root / str(params["prompt"])
    prompt_sha256 = sha256_file(prompt_path)
    rendered = [
        RenderedDocument.model_validate(item)
        for item in read_jsonl(root / "outputs/rendered/documents.jsonl")
    ]
    output_dir = root / "outputs/extraction"
    _reset_directory(output_dir, root)
    predictions: list[PredictionRecord] = []
    failures: list[dict[str, str]] = []
    threshold = float(params["extraction"]["confidenceThreshold"])
    for document in rendered:
        latency_ms, cost_microusd = _operational_metrics(document.text, params)
        extraction_value: CanonicalExtraction | None = None
        abstention: Abstention | None = None
        confidence = 0.0
        if document.prompt_injection_detected:
            abstention = Abstention(
                reason="prompt_injection",
                detail="rendered content matched a configured prompt-injection signal",
            )
        else:
            try:
                parsed, confidence = _parse_extraction(document.document_id, document.text)
                if confidence < threshold:
                    abstention = Abstention(
                        reason="low_confidence",
                        detail=f"confidence {confidence:.2f} is below threshold {threshold:.2f}",
                    )
                else:
                    extraction_value = parsed
            except (KeyError, TypeError, ValueError) as error:
                abstention = Abstention(reason="parser_failure", detail=str(error))
                failures.append(
                    {
                        "document_id": document.document_id,
                        "code": "parser_failure",
                        "detail": str(error),
                    }
                )
        predictions.append(
            PredictionRecord(
                document_id=document.document_id,
                provider=model_manifest["provider"],
                model=model_manifest["model"],
                parser_version=model_manifest["parserVersion"],
                prompt_version=model_manifest["promptVersion"],
                prompt_sha256=prompt_sha256,
                confidence=confidence,
                latency_ms=latency_ms,
                cost_microusd=cost_microusd,
                extraction=extraction_value,
                abstention=abstention,
            )
        )
    write_jsonl(output_dir / "predictions.jsonl", predictions)
    write_json(output_dir / "failures.json", failures)
    write_json(
        output_dir / "run.json",
        {
            "schema_version": "1.0.0",
            "pipeline_version": params["pipelineVersion"],
            "code_revision": code_revision(root),
            "params_sha256": sha256_file(root / "params.yaml"),
            "prompt_sha256": prompt_sha256,
            "model_manifest_sha256": sha256_file(root / str(params["modelManifest"])),
            "corpus_manifest_sha256": sha256_file(root / "data/corpus/manifest.json"),
            "documents": len(predictions),
            "failures": len(failures),
        },
    )


def _normalize_extraction(extraction: CanonicalExtraction) -> CanonicalExtraction:
    value = extraction.model_dump(mode="json")
    for account in value["accounts"]:
        account["display_name"] = " ".join(account["display_name"].split())
        account["currency"] = account["currency"].upper()
    for transaction in value["transactions"]:
        transaction["description"] = " ".join(transaction["description"].split())
        transaction["amount"]["currency"] = transaction["amount"]["currency"].upper()
    value["accounts"].sort(key=lambda item: item["account_id"])
    value["periods"].sort(key=lambda item: item["period_id"])
    value["balances"].sort(key=lambda item: item["balance_id"])
    value["transactions"].sort(key=lambda item: item["transaction_id"])
    value["currencies"] = sorted(set(value["currencies"]))
    return CanonicalExtraction.model_validate(value)


def normalize(root: Path | None = None) -> None:
    root = root or project_root()
    predictions = [
        PredictionRecord.model_validate(item)
        for item in read_jsonl(root / "outputs/extraction/predictions.jsonl")
    ]
    output_dir = root / "outputs/normalized"
    _reset_directory(output_dir, root)
    normalized: list[PredictionRecord] = []
    failures: list[dict[str, str]] = []
    for prediction in predictions:
        try:
            extraction_value = (
                _normalize_extraction(prediction.extraction) if prediction.extraction else None
            )
            normalized.append(prediction.model_copy(update={"extraction": extraction_value}))
        except (TypeError, ValueError) as error:
            failures.append(
                {
                    "document_id": prediction.document_id,
                    "code": "normalization_failure",
                    "detail": str(error),
                }
            )
    write_jsonl(output_dir / "predictions.jsonl", normalized)
    write_json(output_dir / "failures.json", failures)


def _flatten_fields(value: Any, prefix: str = "") -> dict[str, Any]:
    fields: dict[str, Any] = {}
    if isinstance(value, dict):
        for key in sorted(value):
            if not prefix and key == "transactions":
                continue
            child_prefix = f"{prefix}.{key}" if prefix else key
            fields.update(_flatten_fields(value[key], child_prefix))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            fields.update(_flatten_fields(item, f"{prefix}[{index}]"))
    else:
        fields[prefix] = value
    return fields


def _transaction_counter(extraction: CanonicalExtraction) -> Counter[bytes]:
    return Counter(
        canonical_bytes(item.model_dump(mode="json")) for item in extraction.transactions
    )


def _reconciles(extraction: CanonicalExtraction) -> bool:
    checks: list[bool] = []
    for account in extraction.accounts:
        for period in extraction.periods:
            relevant = [
                balance
                for balance in extraction.balances
                if balance.account_id == account.account_id
                and balance.period_id == period.period_id
            ]
            openings = [balance for balance in relevant if balance.kind == "opening"]
            closings = [balance for balance in relevant if balance.kind == "closing"]
            if not openings and not closings:
                continue
            if len(openings) != 1 or len(closings) != 1:
                checks.append(False)
                continue
            transaction_total = sum(
                transaction.amount.minor_units
                for transaction in extraction.transactions
                if transaction.account_id == account.account_id
                and transaction.period_id == period.period_id
            )
            checks.append(
                openings[0].amount.currency == closings[0].amount.currency
                and openings[0].amount.minor_units + transaction_total
                == closings[0].amount.minor_units
            )
    return bool(checks) and all(checks)


def match(root: Path | None = None) -> None:
    root = root or project_root()
    corpus_dir = root / "data/corpus"
    manifest = load_model(corpus_dir / "manifest.json", CorpusManifest)
    predictions = {
        item.document_id: item
        for item in (
            PredictionRecord.model_validate(value)
            for value in read_jsonl(root / "outputs/normalized/predictions.jsonl")
        )
    }
    output_dir = root / "outputs/matching"
    _reset_directory(output_dir, root)
    records: list[MatchRecord] = []
    for entry in manifest.documents:
        expected = _normalize_extraction(
            load_model(corpus_dir / entry.ground_truth_path, CanonicalExtraction)
        )
        prediction = predictions[entry.document_id]
        expected_fields = _flatten_fields(expected.model_dump(mode="json"))
        actual_fields = (
            _flatten_fields(prediction.extraction.model_dump(mode="json"))
            if prediction.extraction
            else {}
        )
        field_correct = sum(
            actual_fields.get(field) == value for field, value in expected_fields.items()
        )
        expected_rows = _transaction_counter(expected)
        actual_rows = (
            _transaction_counter(prediction.extraction) if prediction.extraction else Counter()
        )
        true_positive = sum((expected_rows & actual_rows).values())
        false_positive = sum((actual_rows - expected_rows).values())
        false_negative = sum((expected_rows - actual_rows).values())
        actual_reason = prediction.abstention.reason if prediction.abstention else None
        errors: list[str] = []
        if entry.expected_abstention:
            if actual_reason != entry.expected_abstention_reason:
                errors.append("expected abstention reason did not match")
            field_correct = 0
            expected_fields = {}
            true_positive = false_positive = false_negative = 0
        elif prediction.abstention:
            errors.append(f"unexpected abstention: {prediction.abstention.reason}")
        else:
            if field_correct != len(expected_fields):
                errors.append("one or more canonical fields did not match")
            if false_positive or false_negative:
                errors.append("one or more transaction rows did not match")
        adversarial_defended = (
            actual_reason == "prompt_injection"
            if "prompt-injection" in entry.adversarial_tags
            else None
        )
        records.append(
            MatchRecord(
                document_id=entry.document_id,
                provider=prediction.provider,
                expected_abstention=entry.expected_abstention,
                expected_abstention_reason=entry.expected_abstention_reason,
                actual_abstention_reason=actual_reason,
                field_correct=field_correct,
                field_total=len(expected_fields),
                row_true_positive=true_positive,
                row_false_positive=false_positive,
                row_false_negative=false_negative,
                reconciled=(_reconciles(prediction.extraction) if prediction.extraction else None),
                adversarial_defended=adversarial_defended,
                errors=errors,
            )
        )
    write_jsonl(output_dir / "records.jsonl", records)
    write_json(
        output_dir / "errors.json",
        [
            {"document_id": record.document_id, "errors": record.errors}
            for record in records
            if record.errors
        ],
    )


def _safe_ratio(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 1.0


def _nearest_rank(values: Iterable[int], quantile: float) -> int:
    ordered = sorted(values)
    if not ordered:
        return 0
    return ordered[max(0, math.ceil(quantile * len(ordered)) - 1)]


def _metric_summary(
    records: list[MatchRecord], predictions: dict[str, PredictionRecord]
) -> dict[str, int | float]:
    field_correct = sum(record.field_correct for record in records)
    field_total = sum(record.field_total for record in records)
    true_positive = sum(record.row_true_positive for record in records)
    false_positive = sum(record.row_false_positive for record in records)
    false_negative = sum(record.row_false_negative for record in records)
    reconciliation = [record.reconciled for record in records if record.reconciled is not None]
    expected_abstentions = [record for record in records if record.expected_abstention]
    expected_abstentions_met = sum(
        record.actual_abstention_reason == record.expected_abstention_reason
        for record in expected_abstentions
    )
    adversarial = [
        record.adversarial_defended for record in records if record.adversarial_defended is not None
    ]
    selected_predictions = [predictions[record.document_id] for record in records]
    total_cost = sum(item.cost_microusd for item in selected_predictions)
    return {
        "documents": len(records),
        "field_accuracy": _safe_ratio(field_correct, field_total),
        "row_precision": _safe_ratio(true_positive, true_positive + false_positive),
        "row_recall": _safe_ratio(true_positive, true_positive + false_negative),
        "balance_reconciliation_rate": _safe_ratio(sum(reconciliation), len(reconciliation)),
        "expected_abstention_recall": _safe_ratio(
            expected_abstentions_met, len(expected_abstentions)
        ),
        "adversarial_defense_rate": _safe_ratio(sum(adversarial), len(adversarial)),
        "cost_microusd": total_cost,
        "cost_usd": total_cost / 1_000_000,
        "cost_usd_per_document": _safe_ratio(total_cost, len(selected_predictions)) / 1_000_000,
        "mean_latency_ms": _safe_ratio(
            sum(item.latency_ms for item in selected_predictions), len(selected_predictions)
        ),
        "p95_latency_ms": _nearest_rank((item.latency_ms for item in selected_predictions), 0.95),
    }


def evaluate(root: Path | None = None) -> None:
    root = root or project_root()
    params = load_params(root)
    manifest = load_model(root / "data/corpus/manifest.json", CorpusManifest)
    records = [
        MatchRecord.model_validate(value)
        for value in read_jsonl(root / "outputs/matching/records.jsonl")
    ]
    predictions = {
        item.document_id: item
        for item in (
            PredictionRecord.model_validate(value)
            for value in read_jsonl(root / "outputs/normalized/predictions.jsonl")
        )
    }
    entries = {entry.document_id: entry for entry in manifest.documents}
    summary = _metric_summary(records, predictions)
    groups: dict[str, list[MatchRecord]] = defaultdict(list)
    for record in records:
        entry = entries[record.document_id]
        groups[f"provider={record.provider}"].append(record)
        groups[f"format={entry.strata.document_format}"].append(record)
        groups[f"scan_quality={entry.strata.scan_quality}"].append(record)
        groups[f"language={entry.strata.language}"].append(record)
    strata = {
        key: _metric_summary(group_records, predictions)
        for key, group_records in sorted(groups.items())
    }
    gates = params["releaseGates"]
    gate_results = {
        "field_accuracy": summary["field_accuracy"] >= gates["minimumFieldAccuracy"],
        "row_precision": summary["row_precision"] >= gates["minimumRowPrecision"],
        "row_recall": summary["row_recall"] >= gates["minimumRowRecall"],
        "balance_reconciliation_rate": summary["balance_reconciliation_rate"]
        >= gates["minimumBalanceReconciliationRate"],
        "expected_abstention_recall": summary["expected_abstention_recall"]
        >= gates["minimumExpectedAbstentionRecall"],
        "adversarial_defense_rate": summary["adversarial_defense_rate"]
        >= gates["minimumAdversarialDefenseRate"],
        "cost_usd_per_document": summary["cost_usd_per_document"]
        <= gates["maximumCostUsdPerDocument"],
        "p95_latency_ms": summary["p95_latency_ms"] <= gates["maximumP95LatencyMs"],
    }
    output_dir = root / "outputs/evaluation"
    _reset_directory(output_dir, root)
    metrics = {
        "schema_version": "1.0.0",
        "pipeline_version": params["pipelineVersion"],
        "summary": summary,
        "strata": strata,
        "release_gates": gates,
        "gate_results": gate_results,
    }
    failed = [name for name, passed in gate_results.items() if not passed]
    decision = {
        "schema_version": "1.0.0",
        "decision": "pass" if not failed else "fail",
        "candidate": read_json(root / "models.json"),
        "failed_gates": failed,
        "metrics_sha256": sha256_bytes(pretty_bytes(metrics)),
    }
    write_json(output_dir / "metrics.json", metrics)
    write_json(output_dir / "release-decision.json", decision)
    lines = [
        "# Parser release decision",
        "",
        f"Decision: `{decision['decision']}`.",
        "",
        f"Field accuracy: {summary['field_accuracy']:.3f}",
        "Transaction precision and recall: "
        f"{summary['row_precision']:.3f} / {summary['row_recall']:.3f}",
        f"Balance reconciliation: {summary['balance_reconciliation_rate']:.3f}",
        f"Expected abstention recall: {summary['expected_abstention_recall']:.3f}",
        f"Adversarial defense: {summary['adversarial_defense_rate']:.3f}",
        f"Mean cost per document: ${summary['cost_usd_per_document']:.6f}",
        f"P95 latency: {summary['p95_latency_ms']} ms",
        "",
    ]
    if failed:
        lines.extend(["Failed gates:", "", *[f"- {gate}" for gate in failed], ""])
    (output_dir / "release-decision.md").write_text("\n".join(lines), encoding="utf-8")


def error_analysis(root: Path | None = None) -> None:
    root = root or project_root()
    manifest = load_model(root / "data/corpus/manifest.json", CorpusManifest)
    matching_errors = read_json(root / "outputs/matching/errors.json")
    stage_failures: dict[str, Any] = {}
    for stage in ("rendered", "extraction", "normalized"):
        stage_failures[stage] = read_json(root / f"outputs/{stage}/failures.json")
    decision = read_json(root / "outputs/evaluation/release-decision.json")
    output_dir = root / "outputs/error-analysis"
    _reset_directory(output_dir, root)
    expected_abstentions = [
        {
            "document_id": entry.document_id,
            "reason": entry.expected_abstention_reason,
            "adversarial_tags": entry.adversarial_tags,
        }
        for entry in manifest.documents
        if entry.expected_abstention
    ]
    analysis = {
        "schema_version": "1.0.0",
        "unexpected_errors": matching_errors,
        "stage_failures": stage_failures,
        "expected_abstentions": expected_abstentions,
        "failed_release_gates": decision["failed_gates"],
    }
    write_json(output_dir / "errors.json", analysis)
    artifact_paths = sorted(
        path
        for path in (root / "outputs").rglob("*")
        if path.is_file() and output_dir not in path.parents
    )
    provenance = {
        "schema_version": "1.0.0",
        "code_revision": code_revision(root),
        "params_sha256": sha256_file(root / "params.yaml"),
        "prompt_sha256": sha256_file(root / "prompts/extraction-v1.txt"),
        "model_manifest_sha256": sha256_file(root / "models.json"),
        "corpus_manifest_sha256": sha256_file(root / "data/corpus/manifest.json"),
        "artifacts": [
            {
                "path": path.relative_to(root).as_posix(),
                "sha256": sha256_file(path),
            }
            for path in artifact_paths
        ],
    }
    write_json(output_dir / "provenance.json", provenance)
    failure_count = len(matching_errors) + sum(len(items) for items in stage_failures.values())
    summary = (
        "# Error analysis\n\n"
        f"Unexpected errors: {failure_count}.\n\n"
        f"Expected abstentions: {len(expected_abstentions)}.\n\n"
        f"Failed release gates: {len(decision['failed_gates'])}.\n"
    )
    (output_dir / "summary.md").write_text(summary, encoding="utf-8")


def write_schemas(*, check: bool, root: Path | None = None) -> None:
    root = root or project_root()
    schemas = {
        root / "schemas/canonical-extraction.schema.json": CanonicalExtraction.model_json_schema(),
        root / "schemas/corpus-manifest.schema.json": CorpusManifest.model_json_schema(),
    }
    drifted: list[str] = []
    for path, schema in schemas.items():
        expected = pretty_bytes(schema)
        if check:
            if not path.exists() or path.read_bytes() != expected:
                drifted.append(path.relative_to(root).as_posix())
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(expected)
    if drifted:
        raise ValueError(f"JSON Schema drift: {', '.join(drifted)}")


def verify(root: Path | None = None) -> None:
    root = root or project_root()
    manifest = load_model(root / "data/corpus/manifest.json", CorpusManifest)
    if any(
        not entry.synthetic and entry.redaction_status != "strongly_redacted"
        for entry in manifest.documents
    ):
        raise ValueError("corpus contains an unredacted non-synthetic document")
    for entry in manifest.documents:
        load_model(root / "data/corpus" / entry.ground_truth_path, CanonicalExtraction)
    for value in read_jsonl(root / "outputs/normalized/predictions.jsonl"):
        PredictionRecord.model_validate(value)
    decision = read_json(root / "outputs/evaluation/release-decision.json")
    if decision["decision"] != "pass" or decision["failed_gates"]:
        raise ValueError("candidate does not pass the release gates")
    provenance = read_json(root / "outputs/error-analysis/provenance.json")
    for artifact in provenance["artifacts"]:
        if sha256_file(root / artifact["path"]) != artifact["sha256"]:
            raise ValueError(f"artifact hash mismatch: {artifact['path']}")
    write_schemas(check=True, root=root)
    print(f"verified {len(manifest.documents)} synthetic or redacted documents")
