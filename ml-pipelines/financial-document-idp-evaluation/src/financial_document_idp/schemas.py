from __future__ import annotations

from datetime import date
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Sha256 = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
CurrencyCode = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]
SafeIdentifier = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9._-]*$")]
AccountType = Literal["checking", "savings", "credit_card", "payroll"]
BalanceKind = Literal["opening", "closing", "available", "net_pay"]


class StrictModel(BaseModel):
    """Reject undeclared fields so artifact drift fails at the stage boundary."""

    model_config = ConfigDict(extra="forbid")


class DocumentFamily(StrEnum):
    BANK_STATEMENT = "bank_statement"
    CREDIT_CARD_STATEMENT = "credit_card_statement"
    PAYSLIP = "payslip"


class DocumentFormat(StrEnum):
    PDF_TEXT = "pdf_text"
    HTML = "html"
    PGM_SCAN = "pgm_scan"


class ScanQuality(StrEnum):
    NATIVE = "native"
    CLEAN_SCAN = "clean_scan"
    DEGRADED_SCAN = "degraded_scan"


class Account(StrictModel):
    account_id: SafeIdentifier
    account_type: AccountType
    display_name: str = Field(min_length=1, max_length=120)
    currency: CurrencyCode


class Period(StrictModel):
    period_id: SafeIdentifier
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def dates_are_ordered(self) -> Period:
        if self.end_date < self.start_date:
            msg = "end_date must not precede start_date"
            raise ValueError(msg)
        return self


class Money(StrictModel):
    minor_units: int
    currency: CurrencyCode


class Balance(StrictModel):
    balance_id: SafeIdentifier
    account_id: SafeIdentifier
    period_id: SafeIdentifier
    kind: BalanceKind
    amount: Money


class Transaction(StrictModel):
    transaction_id: SafeIdentifier
    account_id: SafeIdentifier
    period_id: SafeIdentifier
    posted_date: date
    description: str = Field(min_length=1, max_length=240)
    amount: Money


class DocumentMetadata(StrictModel):
    issued_date: date
    page_count: int = Field(ge=1, le=1000)
    language: Annotated[str, StringConstraints(pattern=r"^[a-z]{2}$")]
    source_format: DocumentFormat


class CanonicalExtraction(StrictModel):
    schema_version: Literal["1.0.0"]
    document_id: SafeIdentifier
    family: DocumentFamily
    metadata: DocumentMetadata
    accounts: list[Account] = Field(min_length=1)
    periods: list[Period] = Field(min_length=1)
    balances: list[Balance] = Field(min_length=1)
    transactions: list[Transaction]
    currencies: list[CurrencyCode] = Field(min_length=1)

    @model_validator(mode="after")
    def references_are_valid(self) -> CanonicalExtraction:
        account_ids = {account.account_id for account in self.accounts}
        period_ids = {period.period_id for period in self.periods}
        if len(account_ids) != len(self.accounts):
            raise ValueError("account_id values must be unique")
        if len(period_ids) != len(self.periods):
            raise ValueError("period_id values must be unique")
        if len(set(self.currencies)) != len(self.currencies):
            raise ValueError("currencies must be unique")
        for balance in self.balances:
            if balance.account_id not in account_ids or balance.period_id not in period_ids:
                raise ValueError("balance references an unknown account or period")
        transaction_ids: set[str] = set()
        for transaction in self.transactions:
            if transaction.transaction_id in transaction_ids:
                raise ValueError("transaction_id values must be unique")
            transaction_ids.add(transaction.transaction_id)
            if transaction.account_id not in account_ids or transaction.period_id not in period_ids:
                raise ValueError("transaction references an unknown account or period")
        used_currencies = {
            *(account.currency for account in self.accounts),
            *(balance.amount.currency for balance in self.balances),
            *(transaction.amount.currency for transaction in self.transactions),
        }
        if used_currencies != set(self.currencies):
            raise ValueError("currencies must equal the currencies used by extracted facts")
        return self


class CorpusStrata(StrictModel):
    document_format: DocumentFormat
    scan_quality: ScanQuality
    language: Annotated[str, StringConstraints(pattern=r"^[a-z]{2}$")]


class CorpusManifestEntry(StrictModel):
    document_id: SafeIdentifier
    family: DocumentFamily
    relative_path: str = Field(pattern=r"^documents/[a-z0-9._-]+$")
    mime_type: Literal["application/pdf", "text/html", "image/x-portable-graymap"]
    sha256: Sha256
    byte_size: int = Field(ge=1)
    source_rights: str = Field(min_length=1)
    consent_or_generation_method: str = Field(min_length=1)
    redaction_status: Literal["not_applicable_synthetic", "strongly_redacted"]
    synthetic: bool
    strata: CorpusStrata
    ground_truth_path: str = Field(pattern=r"^ground-truth/[a-z0-9._-]+\.json$")
    expected_abstention: bool
    expected_abstention_reason: Literal["prompt_injection", "low_confidence"] | None
    adversarial_tags: list[SafeIdentifier]

    @model_validator(mode="after")
    def abstention_reason_matches_expectation(self) -> CorpusManifestEntry:
        if self.expected_abstention != (self.expected_abstention_reason is not None):
            raise ValueError("expected_abstention and its reason must agree")
        if not self.synthetic and self.redaction_status != "strongly_redacted":
            raise ValueError("non-synthetic documents must be strongly redacted")
        return self


class CorpusManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    corpus_version: str = Field(pattern=r"^[0-9]+\.[0-9]+\.[0-9]+$")
    generated_at: str = Field(pattern=r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T00:00:00Z$")
    privacy_policy: Literal["synthetic_or_strongly_redacted_only"]
    documents: list[CorpusManifestEntry] = Field(min_length=1)

    @model_validator(mode="after")
    def document_ids_are_unique(self) -> CorpusManifest:
        document_ids = [document.document_id for document in self.documents]
        if len(document_ids) != len(set(document_ids)):
            raise ValueError("manifest document_id values must be unique")
        return self


class CorpusSpecDocument(StrictModel):
    document_id: SafeIdentifier
    family: DocumentFamily
    mime_type: Literal["application/pdf", "text/html", "image/x-portable-graymap"]
    source_rights: str
    consent_or_generation_method: str
    redaction_status: Literal["not_applicable_synthetic", "strongly_redacted"]
    synthetic: bool
    strata: CorpusStrata
    expected_abstention: bool
    expected_abstention_reason: Literal["prompt_injection", "low_confidence"] | None
    adversarial_tags: list[SafeIdentifier]
    content: str = Field(min_length=1)
    ground_truth: CanonicalExtraction

    @model_validator(mode="after")
    def identifiers_match(self) -> CorpusSpecDocument:
        if self.document_id != self.ground_truth.document_id:
            raise ValueError("spec and ground-truth document_id values must match")
        if self.family != self.ground_truth.family:
            raise ValueError("spec and ground-truth family values must match")
        if self.strata.document_format != self.ground_truth.metadata.source_format:
            raise ValueError("spec and ground-truth formats must match")
        return self


class CorpusSpec(StrictModel):
    schema_version: Literal["1.0.0"]
    corpus_version: str = Field(pattern=r"^[0-9]+\.[0-9]+\.[0-9]+$")
    generated_at: str
    documents: list[CorpusSpecDocument] = Field(min_length=1)


class RenderedDocument(StrictModel):
    document_id: SafeIdentifier
    text: str
    sha256: Sha256
    prompt_injection_detected: bool
    prompt_injection_signals: list[str]


class Abstention(StrictModel):
    reason: Literal["prompt_injection", "low_confidence", "unsafe_file", "parser_failure"]
    detail: str


class PredictionRecord(StrictModel):
    document_id: SafeIdentifier
    provider: SafeIdentifier
    model: SafeIdentifier
    parser_version: str
    prompt_version: SafeIdentifier
    prompt_sha256: Sha256
    confidence: float = Field(ge=0, le=1)
    latency_ms: int = Field(ge=0)
    cost_microusd: int = Field(ge=0)
    extraction: CanonicalExtraction | None
    abstention: Abstention | None

    @model_validator(mode="after")
    def result_is_extraction_or_abstention(self) -> PredictionRecord:
        if (self.extraction is None) == (self.abstention is None):
            raise ValueError("exactly one of extraction or abstention is required")
        return self


class MatchRecord(StrictModel):
    document_id: SafeIdentifier
    provider: SafeIdentifier
    expected_abstention: bool
    expected_abstention_reason: str | None
    actual_abstention_reason: str | None
    field_correct: int = Field(ge=0)
    field_total: int = Field(ge=0)
    row_true_positive: int = Field(ge=0)
    row_false_positive: int = Field(ge=0)
    row_false_negative: int = Field(ge=0)
    reconciled: bool | None
    adversarial_defended: bool | None
    errors: list[str]
