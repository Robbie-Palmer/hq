from __future__ import annotations

import hashlib
import json
import re
import statistics
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Literal

import fire
import torch
import transformers
from pydantic import BaseModel, ConfigDict, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from transformers import AutoModelForTokenClassification, AutoTokenizer

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MARK_CHARACTERS = (
    ".,;:!?\u3002\uff0c\u3001\uff1b\uff1a\uff01\uff1f\u061f\u060c"
    "\u00bf\u00a1\u2026\u0964\u0965\u06d4\u1362\u1363\u1367"
)
MARKS = re.compile(f"[{MARK_CHARACTERS}]")
TRAILING_MARKS = frozenset(MARK_CHARACTERS)
FLOAT16_ERROR = "the pinned punctuation runtime requires float16"
CUDA_ERROR = "the punctuation candidate requires CUDA"


class ImmutableModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class RuntimeSettings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    cublas_workspace_config: Literal[":4096:8"] = Field(
        validation_alias="CUBLAS_WORKSPACE_CONFIG"
    )


class RuntimeCommand(ImmutableModel):
    evidence_manifest: Path
    evidence_root: Path
    experiment: Path
    model: Path
    output: Path


class ExperimentParameters(ImmutableModel):
    chunk_tokens: int = Field(alias="chunkTokens", gt=0)
    overlap_tokens: int = Field(alias="overlapTokens", ge=0)
    minimum_comma_probability: float = Field(alias="minimumCommaProbability", ge=0, le=1)
    dtype: str


class Experiment(ImmutableModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    schema_version: int = Field(alias="schemaVersion")
    failure_class: str = Field(alias="failureClass")
    parameters: ExperimentParameters


class EvidenceEntry(ImmutableModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    artifact_id: str = Field(alias="artifactId")
    source_before_file: str = Field(alias="sourceBeforeFile")
    records_file: str = Field(alias="recordsFile")


class EvidenceManifest(ImmutableModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    cohort_id: str = Field(alias="cohortId")
    entries: tuple[EvidenceEntry, ...]


class SourceRecords(ImmutableModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    document_id: str = Field(alias="documentId")
    revision: str


class TextSegment(ImmutableModel):
    start: int
    end: int


def sha256_text(value: str) -> str:
    return f"sha256:{hashlib.sha256(value.encode('utf-8')).hexdigest()}"


def read_model[ModelType: BaseModel](path: Path, model_type: type[ModelType]) -> ModelType:
    return model_type.model_validate_json(path.read_text(encoding="utf-8"))


def split_line(line: str) -> tuple[str, str]:
    terminator_match = re.search(r"(?:\r\n|\n|\r)$", line)
    terminator = terminator_match.group(0) if terminator_match else ""
    return line[: -len(terminator)] if terminator else line, terminator


class MarkdownSegmenter:
    def __init__(self, source: str) -> None:
        self.source = source
        self.segments: list[TextSegment] = []
        self.paragraph_start: int | None = None
        self.paragraph_end: int | None = None
        self.in_frontmatter = source.startswith(("---\n", "---\r\n"))
        self.in_fence = False
        self.in_template_literal = False

    def flush(self) -> None:
        if self.paragraph_start is not None and self.paragraph_end is not None:
            self.segments.append(TextSegment(start=self.paragraph_start, end=self.paragraph_end))
        self.paragraph_start = None
        self.paragraph_end = None

    def consume_template_literal(self, content: str) -> bool:
        delimiters = len(re.findall(r"(?<!\\)`", content))
        if self.in_template_literal:
            if delimiters % 2 == 1:
                self.in_template_literal = False
            return True
        if delimiters % 2 == 1:
            self.in_template_literal = True
            return True
        return False

    def consume_frontmatter(self, line_index: int, content: str) -> bool:
        if not self.in_frontmatter:
            return False
        self.flush()
        if line_index > 0 and content == "---":
            self.in_frontmatter = False
        return True

    def consume_fence(self, content: str) -> bool:
        if re.match(r"^(?:```|~~~)", content) is None:
            return False
        self.flush()
        self.in_fence = not self.in_fence
        return True

    @staticmethod
    def has_inline_markup(body: str) -> bool:
        patterns = (
            r"\*[^*\n]+\*",
            r"(?<!\w)_[^_\n]+_(?!\w)",
            r"!?\[[^\]\n]*\]\([^)]*\)",
            r"!?\[[^\]\n]*\]\[[^\]\n]*\]",
            r"<(?:https?://|mailto:)[^>\n]+>",
            r"</?[A-Za-z][^>\n]*>",
        )
        return (
            "`" in body
            or "**" in body
            or "__" in body
            or any(re.search(pattern, body) is not None for pattern in patterns)
        )

    @classmethod
    def is_structural(cls, line: str, body: str, content: str) -> bool:
        return any(
            (
                not content,
                re.match(r"^(?:#{1,6}\s|\||>|<|:::)", content) is not None,
                content == "/>",
                re.match(r"^\[[^\]]+\]:\s", content) is not None,
                re.match(r"^\s{4,}\S", line) is not None,
                cls.has_inline_markup(body),
            )
        )

    def extend_paragraph(self, line: str, line_match: re.Match[str], content_end: int) -> None:
        list_match = re.match(r"^\s*(?:[-*+] |\d+[.)] )", line)
        if list_match:
            self.flush()
            self.paragraph_start = line_match.start() + list_match.end()
            self.paragraph_end = content_end
            return
        if self.paragraph_start is None:
            self.paragraph_start = line_match.start() + len(line) - len(line.lstrip())
        self.paragraph_end = content_end

    def consume(self, line_index: int, line_match: re.Match[str]) -> None:
        line = line_match.group(0)
        if not line:
            return
        body, _terminator = split_line(line)
        content = body.strip()
        if self.consume_frontmatter(line_index, content):
            return
        if self.consume_fence(content):
            return
        if self.in_fence or self.consume_template_literal(body):
            self.flush()
            return
        if self.is_structural(line, body, content):
            self.flush()
            return
        content_end = line_match.start() + len(line.rstrip("\r\n "))
        self.extend_paragraph(line, line_match, content_end)


def document_segments(source: str) -> list[TextSegment]:
    segmenter = MarkdownSegmenter(source)
    for line_index, line_match in enumerate(re.finditer(r"[^\n]*(?:\n|$)", source)):
        segmenter.consume(line_index, line_match)
    segmenter.flush()
    return segmenter.segments


def strip_marks_with_boundaries(text: str) -> tuple[str, list[int]]:
    output: list[str] = []
    boundaries = [0]
    for index, character in enumerate(text):
        numeric_separator = (
            character in ".,:"
            and index > 0
            and index + 1 < len(text)
            and text[index - 1].isdigit()
            and text[index + 1].isdigit()
        )
        if MARKS.fullmatch(character) and not numeric_separator:
            continue
        output.append(character)
        boundaries.append(index + 1)
    return "".join(output), boundaries


class PunctuationModel:
    def __init__(self, model_directory: Path, parameters: ExperimentParameters) -> None:
        if parameters.dtype != "float16":
            raise ValueError(FLOAT16_ERROR)
        if not torch.cuda.is_available():
            raise RuntimeError(CUDA_ERROR)
        self.parameters = parameters
        self.device = torch.device("cuda")
        self.tokenizer = AutoTokenizer.from_pretrained(model_directory, local_files_only=True)
        self.model = AutoModelForTokenClassification.from_pretrained(
            model_directory,
            local_files_only=True,
            dtype=torch.float16,
        ).eval().to(self.device)
        self.id2label = self.model.config.id2label

    @torch.no_grad()
    def labels(self, text: str) -> dict[int, tuple[str, float]]:
        encoded = self.tokenizer(text, return_offsets_mapping=True, add_special_tokens=False)
        input_ids = encoded["input_ids"]
        offsets = encoded["offset_mapping"]
        labels: dict[int, tuple[str, float]] = {}
        start = 0
        while start < len(input_ids):
            end = min(len(input_ids), start + self.parameters.chunk_tokens)
            token_ids = [
                self.tokenizer.cls_token_id,
                *input_ids[start:end],
                self.tokenizer.sep_token_id,
            ]
            tensor = torch.tensor([token_ids], device=self.device)
            probabilities = self.model(input_ids=tensor).logits[0, 1:-1].softmax(dim=-1)
            scores, predictions = probabilities.max(dim=-1)
            keep_to = end if end == len(input_ids) else end - self.parameters.overlap_tokens
            for token_index in range(start, keep_to):
                _offset_start, offset_end = offsets[token_index]
                if offset_end > 0:
                    prediction_index = token_index - start
                    labels[offset_end] = (
                        self.id2label[int(predictions[prediction_index])],
                        float(scores[prediction_index]),
                    )
            if end == len(input_ids):
                break
            start = keep_to
        return labels

    def comma_insertions(self, source: str) -> list[dict[str, int | float]]:
        insertions: dict[int, float] = {}
        for segment in document_segments(source):
            segment_source = source[segment.start : segment.end]
            cleaned, boundaries = strip_marks_with_boundaries(segment_source)
            if not cleaned.strip():
                continue
            for cleaned_end, (label, probability) in self.labels(cleaned).items():
                if label != "," or probability < self.parameters.minimum_comma_probability:
                    continue
                if cleaned_end < len(cleaned) and not cleaned[cleaned_end].isspace():
                    continue
                original_offset = segment.start + boundaries[cleaned_end]
                if original_offset < len(source) and source[original_offset] in TRAILING_MARKS:
                    continue
                byte_offset = len(source[:original_offset].encode("utf-8"))
                insertions[byte_offset] = max(insertions.get(byte_offset, 0), probability)
        return [
            {"byteOffset": byte_offset, "confidence": insertions[byte_offset]}
            for byte_offset in sorted(insertions)
        ]


def percentile_median(values: list[float]) -> float:
    return statistics.median(values) if values else 0.0


def run_job(command: RuntimeCommand) -> dict[str, Any]:
    evidence_root = command.evidence_root.resolve()
    manifest = read_model(command.evidence_manifest, EvidenceManifest)
    experiment = read_model(command.experiment, Experiment)
    model = PunctuationModel(command.model, experiment.parameters)
    torch.cuda.reset_peak_memory_stats()
    artifacts: list[dict[str, Any]] = []
    timings: list[float] = []

    for entry in manifest.entries:
        source = (evidence_root / entry.source_before_file).read_text(encoding="utf-8")
        records = read_model(evidence_root / entry.records_file, SourceRecords)
        started = time.perf_counter()
        insertions = model.comma_insertions(source)
        torch.cuda.synchronize()
        elapsed = (time.perf_counter() - started) * 1000
        timings.append(elapsed)
        artifacts.append({
            "artifactId": entry.artifact_id,
            "documentId": records.document_id,
            "revision": records.revision,
            "contentHash": sha256_text(source),
            "insertions": insertions,
            "inferenceMilliseconds": elapsed,
        })

    total_insertions = sum(len(artifact["insertions"]) for artifact in artifacts)
    return {
        "schemaVersion": 1,
        "recordType": "punctuation-restoration-raw-run",
        "cohortId": manifest.cohort_id,
        "model": {
            "modelId": "horizon-punctuation-restoration-small",
            "revision": "ee31fdfc5304f876ea3b0dd72d30eda7e940b2b1",
            "checkpointContentHash": (
                "sha256:85f724b61415c131afa1eb308bafefa9"
                "9799221b1fbade5e59568e55b3dc6e48"
            ),
        },
        "runtime": {
            "pythonVersion": ".".join(map(str, __import__("sys").version_info[:3])),
            "torchVersion": torch.__version__,
            "transformersVersion": transformers.__version__,
            "cudaVersion": torch.version.cuda,
            "device": "cuda",
            "gpuName": torch.cuda.get_device_name(),
            "computeCapability": ".".join(map(str, torch.cuda.get_device_capability())),
            "peakCudaAllocatedBytes": torch.cuda.max_memory_allocated(),
        },
        "parameters": experiment.parameters.model_dump(by_alias=True),
        "artifacts": artifacts,
        "summary": {
            "artifacts": len(artifacts),
            "insertions": total_insertions,
            "medianInferenceMillisecondsPerArtifact": percentile_median(timings),
        },
    }


def run(
    evidence_manifest: str,
    evidence_root: str,
    experiment: str,
    model: str,
    output: str,
) -> None:
    RuntimeSettings()
    command = RuntimeCommand(
        evidence_manifest=Path(evidence_manifest),
        evidence_root=Path(evidence_root),
        experiment=Path(experiment),
        model=Path(model),
        output=Path(output),
    )
    result = run_job(command)
    command.output.parent.mkdir(parents=True, exist_ok=True)
    command.output.write_text(
        f"{json.dumps(result, sort_keys=True, separators=(',', ':'))}\n",
        encoding="utf-8",
    )
    print(
        f"Punctuation candidate wrote {result['summary']['insertions']} comma insertions "
        f"across {result['summary']['artifacts']} artifacts"
    )


def main(command: Sequence[str] | None = None) -> None:
    fire.Fire(
        run,
        command=list(command) if command is not None else None,
        name="punctuation-runtime",
    )


if __name__ == "__main__":
    main()
