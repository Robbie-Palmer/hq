from __future__ import annotations

import fnmatch
import hashlib
import json
import platform
import re
from base64 import b64decode
from collections.abc import Sequence
from difflib import SequenceMatcher
from pathlib import Path
from typing import Annotated, Literal, Self

import fire
import torch
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from torch import Tensor, nn
from transformers import AutoConfig, AutoModel, AutoTokenizer
from transformers import __version__ as transformers_version

# GECToR uses this sentinel as a token, not as a credential.
START_TOKEN = "$START"  # noqa: S105
KEEP = "$KEEP"
PADDING = "@@PADDING@@"
UNKNOWN = "@@UNKNOWN@@"
MERGE_PREFIX = "$MERGE_"
APPEND_PREFIX = "$APPEND_"
MAX_PIECES_PER_TOKEN = 5
ENCODER_PREFIX = "text_field_embedder.token_embedder_bert.bert_model."
LABEL_WEIGHT = "tag_labels_projection_layer._module.weight"
LABEL_BIAS = "tag_labels_projection_layer._module.bias"
DETECT_WEIGHT = "tag_detect_projection_layer._module.weight"
DETECT_BIAS = "tag_detect_projection_layer._module.bias"
GIT_REVISION_PATTERN = r"^[a-f0-9]{40}$"
CONTENT_DIGEST_PATTERN = r"^sha256:[a-f0-9]{64}$"
OCI_TITLE_ANNOTATION = "org.opencontainers.image.title"
OCI_SOURCE_ANNOTATION = "org.opencontainers.image.source"
OCI_REVISION_ANNOTATION = "org.opencontainers.image.revision"
MODEL_WEIGHT_MEDIA_TYPE = "application/vnd.cncf.model.weight.v1.raw"
MODEL_WEIGHT_CONFIG_MEDIA_TYPE = "application/vnd.cncf.model.weight.config.v1.raw"
GECTOR_RUNTIME_LAYER_MEDIA_TYPES = frozenset(
    {
        ("gector-2024-roberta-large.th", MODEL_WEIGHT_MEDIA_TYPE),
        ("roberta-large/config.json", MODEL_WEIGHT_CONFIG_MEDIA_TYPE),
        ("roberta-large/merges.txt", MODEL_WEIGHT_CONFIG_MEDIA_TYPE),
        ("roberta-large/tokenizer.json", MODEL_WEIGHT_CONFIG_MEDIA_TYPE),
        ("roberta-large/tokenizer_config.json", MODEL_WEIGHT_CONFIG_MEDIA_TYPE),
        ("roberta-large/vocab.json", MODEL_WEIGHT_CONFIG_MEDIA_TYPE),
        ("vocabulary/labels.txt", MODEL_WEIGHT_CONFIG_MEDIA_TYPE),
        ("vocabulary/d_tags.txt", MODEL_WEIGHT_CONFIG_MEDIA_TYPE),
        ("vocabulary/non_padded_namespaces.txt", MODEL_WEIGHT_CONFIG_MEDIA_TYPE),
        ("verb-form-vocab.txt", MODEL_WEIGHT_CONFIG_MEDIA_TYPE),
    }
)
PROJECT_ROOT = Path(__file__).resolve().parent.parent
MODEL_DIRECTORY = PROJECT_ROOT / "data/models/gector-2024"
MODEL_MANIFEST = PROJECT_ROOT / "model-manifest.json"
PARAMETERS_FILE = PROJECT_ROOT / "params.yaml"
FROZEN_COHORT = PROJECT_ROOT / "outputs/frozen/cohort.json"
CORPUS_ROOT = PROJECT_ROOT / "data/corpus"
RUNTIME_SMOKE_OUTPUT = PROJECT_ROOT / "outputs/smoke/runtime.json"
ADAPTER_SMOKE_OUTPUT = PROJECT_ROOT / "outputs/smoke/gector-raw.json"
COHORT_OUTPUT = PROJECT_ROOT / "outputs/producers/gector/raw-inference.json"
ADAPTER_SMOKE_ARTIFACT = "grammarly-handoff-adr-vale-pass"


class ImmutableModel(BaseModel):
    model_config = ConfigDict(frozen=True, populate_by_name=True, extra="forbid")


class RuntimeSettings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    cublas_workspace_config: Literal[":4096:8"] = Field(
        validation_alias="CUBLAS_WORKSPACE_CONFIG"
    )


class InferenceParameters(ImmutableModel):
    batch_size: Annotated[int, Field(gt=0)] = Field(validation_alias="batchSize")
    iterations: Annotated[int, Field(gt=0)]
    max_tokens: Annotated[int, Field(gt=0)] = Field(validation_alias="maxTokens")
    min_tokens: Annotated[int, Field(gt=0)] = Field(validation_alias="minTokens")
    min_error_probability: Annotated[float, Field(ge=0, le=1)] = Field(
        validation_alias="minErrorProbability"
    )
    min_token_probability: Annotated[float, Field(ge=0, le=1)] = Field(
        validation_alias="minTokenProbability"
    )
    additional_confidence: Annotated[float, Field(ge=0, le=1)] = Field(
        validation_alias="additionalConfidence"
    )


class RuntimeDetails(ImmutableModel):
    python_version: str
    torch_version: str
    transformers_version: str
    cuda_version: str
    device: str
    compute_capability: str


class TextSegment(ImmutableModel):
    start: int
    end: int
    tokens: list[str]


class DescriptorAnnotations(ImmutableModel):
    filepath: str = Field(alias="org.cncf.model.filepath")
    title: str = Field(alias=OCI_TITLE_ANNOTATION)
    source: str = Field(alias=OCI_SOURCE_ANNOTATION)
    revision: str = Field(alias=OCI_REVISION_ANNOTATION, pattern=GIT_REVISION_PATTERN)


class ConfigAnnotations(ImmutableModel):
    title: str = Field(alias=OCI_TITLE_ANNOTATION)


class ManifestAnnotations(ImmutableModel):
    title: str = Field(alias=OCI_TITLE_ANNOTATION)
    source: str = Field(alias=OCI_SOURCE_ANNOTATION)
    revision: str = Field(alias=OCI_REVISION_ANNOTATION, pattern=GIT_REVISION_PATTERN)
    checkpoint_license: Literal["not-stated-by-upstream"] = Field(
        alias="me.robbiepalmer.gector.checkpoint-license"
    )
    usage: Literal["evaluation-only"] = Field(alias="me.robbiepalmer.gector.usage")
    modelpack_version: Literal["v0.0.7"] = Field(
        alias="me.robbiepalmer.modelpack.spec-version"
    )


class OciConfigDescriptor(ImmutableModel):
    media_type: Literal["application/vnd.cncf.model.config.v1+json"] = Field(
        alias="mediaType"
    )
    digest: str = Field(pattern=CONTENT_DIGEST_PATTERN)
    size: Annotated[int, Field(gt=0)]
    data: str
    annotations: ConfigAnnotations

    @property
    def decoded(self) -> bytes:
        return b64decode(self.data, validate=True)


class OciLayerDescriptor(ImmutableModel):
    media_type: Literal[
        MODEL_WEIGHT_MEDIA_TYPE,
        MODEL_WEIGHT_CONFIG_MEDIA_TYPE,
    ] = Field(alias="mediaType")
    digest: str = Field(pattern=CONTENT_DIGEST_PATTERN)
    size: Annotated[int, Field(gt=0)]
    urls: tuple[str, ...] = ()
    annotations: DescriptorAnnotations

    @field_validator("urls")
    @classmethod
    def require_https(cls, urls: tuple[str, ...]) -> tuple[str, ...]:
        if any(not url.startswith("https://") for url in urls):
            msg = "OCI descriptor URLs must use HTTPS"
            raise ValueError(msg)
        return urls


class ModelPackDescriptor(ImmutableModel):
    family: Literal["gector"]
    name: Literal["gector-2024-roberta-large"]
    title: str
    description: str
    doc_url: str = Field(alias="docURL")
    source_url: str = Field(alias="sourceURL")
    revision: str = Field(pattern=GIT_REVISION_PATTERN)


class ModelPackCapabilities(ImmutableModel):
    input_types: tuple[Literal["text"]] = Field(alias="inputTypes")
    output_types: tuple[Literal["text"]] = Field(alias="outputTypes")


class ModelPackRuntimeConfig(ImmutableModel):
    architecture: Literal["transformer"]
    format: Literal["pytorch"]
    capabilities: ModelPackCapabilities


class ModelPackFilesystem(ImmutableModel):
    type: Literal["layers"]
    diff_ids: tuple[str, ...] = Field(alias="diffIds", min_length=1)

    @field_validator("diff_ids")
    @classmethod
    def require_content_digests(cls, digests: tuple[str, ...]) -> tuple[str, ...]:
        if any(re.fullmatch(CONTENT_DIGEST_PATTERN, digest) is None for digest in digests):
            msg = "ModelPack diff IDs must be SHA-256 digests"
            raise ValueError(msg)
        return digests


class ModelPackConfig(ImmutableModel):
    descriptor: ModelPackDescriptor
    config: ModelPackRuntimeConfig
    modelfs: ModelPackFilesystem


class GectorModelManifest(ImmutableModel):
    schema_version: Literal[2] = Field(alias="schemaVersion")
    media_type: Literal["application/vnd.oci.image.manifest.v1+json"] = Field(alias="mediaType")
    artifact_type: Literal["application/vnd.cncf.model.manifest.v1+json"] = Field(
        alias="artifactType"
    )
    config: OciConfigDescriptor
    layers: tuple[OciLayerDescriptor, ...] = Field(min_length=1)
    annotations: ManifestAnnotations

    @property
    def metadata(self) -> ModelPackConfig:
        return ModelPackConfig.model_validate_json(self.config.decoded)

    @property
    def checkpoint(self) -> OciLayerDescriptor:
        return next(
            layer
            for layer in self.layers
            if layer.media_type == MODEL_WEIGHT_MEDIA_TYPE
        )

    @model_validator(mode="after")
    def validate_oci_content(self) -> Self:
        decoded = self.config.decoded
        actual_digest = f"sha256:{hashlib.sha256(decoded).hexdigest()}"
        if len(decoded) != self.config.size or actual_digest != self.config.digest:
            msg = "embedded model config does not match its OCI descriptor"
            raise ValueError(msg)
        if (
            self.annotations.source != self.metadata.descriptor.source_url
            or self.annotations.revision != self.metadata.descriptor.revision
        ):
            msg = "OCI annotations do not match the embedded ModelPack config"
            raise ValueError(msg)
        if self.metadata.modelfs.diff_ids != tuple(layer.digest for layer in self.layers):
            msg = "ModelPack diff IDs do not match layers"
            raise ValueError(msg)
        checkpoint_layers = tuple(
            layer
            for layer in self.layers
            if layer.media_type == MODEL_WEIGHT_MEDIA_TYPE
        )
        if len(checkpoint_layers) != 1:
            msg = "ModelPack must contain one checkpoint layer"
            raise ValueError(msg)
        runtime_layout = tuple(
            (layer.annotations.filepath, layer.media_type) for layer in self.layers
        )
        if (
            len({filepath for filepath, _media_type in runtime_layout})
            != len(runtime_layout)
            or frozenset(runtime_layout) != GECTOR_RUNTIME_LAYER_MEDIA_TYPES
        ):
            msg = "ModelPack layers do not match the locked GECToR runtime layout"
            raise ValueError(msg)
        if (
            self.checkpoint.annotations.source != self.metadata.descriptor.source_url
            or self.checkpoint.annotations.revision != self.metadata.descriptor.revision
        ):
            msg = "checkpoint provenance does not match the embedded model config"
            raise ValueError(msg)
        return self


class FrozenSource(ImmutableModel):
    model_config = ConfigDict(frozen=True, populate_by_name=True, extra="ignore")

    file: Path


class FrozenEntry(ImmutableModel):
    model_config = ConfigDict(frozen=True, populate_by_name=True, extra="ignore")

    artifact_id: str = Field(alias="artifactId")
    source: FrozenSource


class FrozenCohort(ImmutableModel):
    model_config = ConfigDict(frozen=True, populate_by_name=True, extra="ignore")

    entries: tuple[FrozenEntry, ...] = Field(min_length=1)


class PipelineProducers(ImmutableModel):
    model_config = ConfigDict(frozen=True, populate_by_name=True, extra="ignore")

    gector: InferenceParameters


class PipelineParameters(ImmutableModel):
    model_config = ConfigDict(frozen=True, populate_by_name=True, extra="ignore")

    producers: PipelineProducers


class InferenceArtifact(ImmutableModel):
    artifact_id: str = Field(alias="artifactId")
    source_file: Path | None = Field(default=None, alias="sourceFile")
    source_text: str | None = Field(default=None, alias="sourceText")

    @model_validator(mode="after")
    def require_one_source(self) -> Self:
        if (self.source_file is None) == (self.source_text is None):
            msg = "inference artifact needs exactly one source"
            raise ValueError(msg)
        return self


class InferenceJob(ImmutableModel):
    artifacts: tuple[InferenceArtifact, ...] = Field(min_length=1)


class RawArtifact(ImmutableModel):
    artifact_id: str = Field(alias="artifactId")
    generated_text: str = Field(alias="generatedText")
    corrected_lines: list[Annotated[int, Field(gt=0)]] = Field(alias="correctedLines")
    iteration_updates: Annotated[int, Field(ge=0)] = Field(alias="iterationUpdates")


class RawModelIdentity(ImmutableModel):
    model_id: Literal["gector-2024-roberta-large"] = Field(alias="modelId")
    source_revision: str = Field(alias="sourceRevision", pattern=GIT_REVISION_PATTERN)
    checkpoint_content_hash: str = Field(
        alias="checkpointContentHash", pattern=CONTENT_DIGEST_PATTERN
    )


class RawRun(ImmutableModel):
    schema_version: Literal[1] = Field(default=1, alias="schemaVersion")
    record_type: Literal["gector-raw-inference-run"] = Field(
        default="gector-raw-inference-run", alias="recordType"
    )
    model: RawModelIdentity
    runtime: RuntimeDetails
    parameters: InferenceParameters
    artifacts: tuple[RawArtifact, ...] = Field(min_length=1)


class RuntimeCommand(ImmutableModel):
    mode: Literal["runtime-smoke", "adapter-smoke", "cohort"]


class ExpectedInference(ImmutableModel):
    job: InferenceJob
    expected: RawArtifact


RUNTIME_SMOKE = ExpectedInference(
    job=InferenceJob(
        artifacts=(
            InferenceArtifact(
                artifactId="gector-runtime-smoke",
                sourceText="He go to school yesterday .\n",
            ),
        )
    ),
    expected=RawArtifact(
        artifactId="gector-runtime-smoke",
        generatedText="He went to school yesterday .\n",
        correctedLines=[1],
        iterationUpdates=1,
    ),
)


def read_model[ModelType: BaseModel](path: Path, model_type: type[ModelType]) -> ModelType:
    return model_type.model_validate_json(path.read_text(encoding="utf-8"))


def project_path(path: Path, project_root: Path = PROJECT_ROOT) -> Path:
    candidate = path if path.is_absolute() else project_root / path
    resolved = candidate.resolve()
    resolved_root = project_root.resolve()
    if resolved == resolved_root or not resolved.is_relative_to(resolved_root):
        msg = f"path {path!s} is outside the project root"
        raise ValueError(msg)
    return resolved


def verify_file_digest(path: Path, expected_digest: str, label: str) -> None:
    with path.open("rb") as input_file:
        actual_digest = f"sha256:{hashlib.file_digest(input_file, 'sha256').hexdigest()}"
    if actual_digest != expected_digest:
        msg = f"{label} hash mismatch: expected {expected_digest}, got {actual_digest}"
        raise RuntimeError(msg)


def frozen_job(artifact_id: str | None = None) -> InferenceJob:
    cohort = read_model(FROZEN_COHORT, FrozenCohort)
    selected = [
        entry for entry in cohort.entries if artifact_id is None or entry.artifact_id == artifact_id
    ]
    if not selected:
        msg = f"frozen cohort does not contain artifact {artifact_id}"
        raise ValueError(msg)
    return InferenceJob(
        artifacts=tuple(
            InferenceArtifact(
                artifactId=entry.artifact_id,
                sourceFile=project_path(CORPUS_ROOT / entry.source.file),
            )
            for entry in selected
        )
    )


def read_vocabulary(path: Path, *, padded: bool) -> list[str]:
    if padded:
        msg = "use read_padded_vocabulary for padded AllenNLP namespaces"
        raise ValueError(msg)
    return path.read_text(encoding="utf-8").splitlines()


def read_padded_vocabulary(path: Path) -> dict[str, int]:
    """Reproduce AllenNLP 0.8.4's serialized padded-namespace indexes."""
    indexes = {PADDING: 0}
    for index, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        indexes[UNKNOWN if line == UNKNOWN else line] = index
    return indexes


def read_verb_forms(path: Path) -> dict[str, str]:
    decoded: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        words, tags = line.split(":", maxsplit=1)
        source, target = words.split("_", maxsplit=1)
        source_tag, target_tag = tags.split("_", maxsplit=1)
        decoded.setdefault(f"{source}_{source_tag}_{target_tag}", target)
    return decoded


def apply_transformation(token: str, transform: str, verb_forms: dict[str, str]) -> str:
    if transform.endswith("CASE_LOWER"):
        return token.lower()
    if transform.endswith("CASE_UPPER"):
        return token.upper()
    if transform.endswith("CASE_CAPITAL"):
        return token.capitalize()
    if transform.endswith("CASE_CAPITAL_1"):
        return token[:1] + token[1:].capitalize()
    if transform.endswith("CASE_UPPER_-1"):
        return token[:-1].upper() + token[-1:]
    if transform.startswith("$TRANSFORM_VERB_"):
        return verb_forms.get(f"{token}_{transform.removeprefix('$TRANSFORM_VERB_')}", token)
    if transform.startswith("$TRANSFORM_SPLIT"):
        return " ".join(token.split("-"))
    if transform.endswith("AGREEMENT_PLURAL"):
        return f"{token}s"
    if transform.endswith("AGREEMENT_SINGULAR"):
        return token[:-1]
    msg = f"unsupported GECToR transformation: {transform}"
    raise ValueError(msg)


def apply_edits(
    source_tokens: list[str],
    edits: list[tuple[int, int, str, float]],
    verb_forms: dict[str, str],
) -> list[str]:
    target_tokens = source_tokens.copy()
    shift = 0
    for start, end, label, _probability in edits:
        position = start + shift
        source_token = target_tokens[position] if 0 <= position < len(target_tokens) else ""
        if label == "":
            del target_tokens[position]
            shift -= 1
        elif start == end:
            target_tokens[position:position] = [label.removeprefix(APPEND_PREFIX)]
            shift += 1
        elif label.startswith("$TRANSFORM_"):
            target_tokens[position] = apply_transformation(source_token, label, verb_forms)
        elif start == end - 1:
            target_tokens[position] = label.removeprefix("$REPLACE_")
        elif label.startswith(MERGE_PREFIX):
            target_tokens[position + 1 : position + 1] = [label]
            shift += 1
        else:
            msg = f"unsupported GECToR edit geometry: {(start, end, label)!r}"
            raise ValueError(msg)

    if any(token.startswith(MERGE_PREFIX) for token in target_tokens):
        merged = " ".join(target_tokens)
        merged = merged.replace(" $MERGE_HYPHEN ", "-")
        merged = merged.replace(" $MERGE_SPACE ", "")
        return merged.split()
    return target_tokens


def word_spans(words: list[str], text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    cursor = 0
    for word in words:
        start = text.index(word, cursor)
        end = start + len(word)
        spans.append((start, end))
        cursor = end
    return spans


def pieces_for_span(
    input_ids: list[int],
    bpe_offsets: list[tuple[int, int]],
    cursor: int,
    word_start: int,
    word_end: int,
) -> tuple[list[int], int]:
    pieces: list[int] = []
    while cursor < len(bpe_offsets):
        bpe_start, bpe_end = bpe_offsets[cursor]
        if bpe_start >= word_end:
            break
        # Match the five-piece token indexer used to train the pinned checkpoint.
        if (
            bpe_start >= word_start
            and bpe_end <= word_end
            and len(pieces) < MAX_PIECES_PER_TOKEN
        ):
            pieces.append(input_ids[cursor])
        cursor += 1
    return pieces, cursor


def encode_words(
    words: list[str],
    text: str,
    input_ids: list[int],
    bpe_offsets: list[tuple[int, int]],
) -> tuple[list[int], list[int]]:
    kept_ids: list[int] = []
    starts: list[int] = []
    bpe_cursor = 0
    for word_start, word_end in word_spans(words, text):
        group, bpe_cursor = pieces_for_span(
            input_ids,
            bpe_offsets,
            bpe_cursor,
            word_start,
            word_end,
        )
        if not group:
            msg = f"tokenizer produced no pieces for {text[word_start:word_end]!r}"
            raise RuntimeError(msg)
        starts.append(len(kept_ids))
        kept_ids.extend(group)
    return kept_ids, starts


def edit_action(index: int, label: str, probability: float) -> tuple[int, int, str, float]:
    if label == "$DELETE":
        return index - 1, index, "", probability
    if label.startswith(("$REPLACE_", "$TRANSFORM_")):
        return index - 1, index, label, probability
    if label.startswith((APPEND_PREFIX, MERGE_PREFIX)):
        return index, index, label, probability
    msg = f"unsupported GECToR label: {label}"
    raise ValueError(msg)


def is_actionable_label(index: int, label: str) -> bool:
    """Only append operations are meaningful at the synthetic start token."""
    return index > 0 or label.startswith(APPEND_PREFIX)


def record_prediction(
    sequence_id: int,
    corrected: list[str],
    final: list[list[str]],
    histories: list[list[list[str]]],
    updates: list[int],
) -> bool:
    if corrected == final[sequence_id]:
        return False
    final[sequence_id] = corrected
    updates[sequence_id] += 1
    if corrected in histories[sequence_id]:
        return False
    histories[sequence_id].append(corrected.copy())
    return True


class GectorModel:
    def __init__(
        self,
        model_directory: Path,
        parameters: InferenceParameters,
        checkpoint_digest: str,
    ) -> None:
        if not torch.cuda.is_available():
            msg = "run_gector requires a CUDA GPU"
            raise RuntimeError(msg)
        self.device = torch.device("cuda:0")
        torch.manual_seed(0)
        torch.cuda.manual_seed_all(0)
        torch.use_deterministic_algorithms(True)
        torch.backends.cuda.matmul.allow_tf32 = False
        self.parameters = parameters
        model_directory = project_path(model_directory)
        namespace_patterns = (
            model_directory / "vocabulary/non_padded_namespaces.txt"
        ).read_text(encoding="utf-8").splitlines()
        for namespace in ("labels", "d_tags"):
            if not any(fnmatch.fnmatchcase(namespace, pattern) for pattern in namespace_patterns):
                msg = f"checkpoint namespace {namespace} must be non-padded"
                raise RuntimeError(msg)
        self.labels = read_vocabulary(model_directory / "vocabulary/labels.txt", padded=False)
        detect_labels = read_vocabulary(
            model_directory / "vocabulary/d_tags.txt",
            padded=False,
        )
        self.incorrect_index = detect_labels.index("INCORRECT")
        self.verb_forms = read_verb_forms(model_directory / "verb-form-vocab.txt")

        encoder_directory = model_directory / "roberta-large"
        self.tokenizer = AutoTokenizer.from_pretrained(
            encoder_directory,
            local_files_only=True,
            use_fast=True,
        )
        if not self.tokenizer.is_fast:
            msg = "the pinned RoBERTa tokenizer must support offset mappings"
            raise RuntimeError(msg)
        added = self.tokenizer.add_tokens([START_TOKEN])
        if added != 1 or len(self.tokenizer) != 50_266:
            msg = "the pinned tokenizer did not assign the expected GECToR start token"
            raise RuntimeError(msg)

        config = AutoConfig.from_pretrained(encoder_directory, local_files_only=True)
        self.encoder = AutoModel.from_config(config)
        self.encoder.resize_token_embeddings(len(self.tokenizer), mean_resizing=False)
        self.label_projection = nn.Linear(config.hidden_size, len(self.labels))
        self.detect_projection = nn.Linear(config.hidden_size, len(detect_labels))
        checkpoint = project_path(model_directory / "gector-2024-roberta-large.th")
        verify_file_digest(checkpoint, checkpoint_digest, "checkpoint")
        self._load_checkpoint(checkpoint)
        self.encoder.to(self.device).eval()
        self.label_projection.to(self.device).eval()
        self.detect_projection.to(self.device).eval()

    def _load_checkpoint(self, checkpoint: Path) -> None:
        state = torch.load(checkpoint, map_location="cpu", mmap=True, weights_only=True)
        encoder_state = {
            key.removeprefix(ENCODER_PREFIX): value
            for key, value in state.items()
            if key.startswith(ENCODER_PREFIX)
        }
        incompatible = self.encoder.load_state_dict(encoder_state, strict=False)
        if incompatible.missing_keys or incompatible.unexpected_keys != ["embeddings.position_ids"]:
            msg = (
                "checkpoint encoder keys do not match the locked runtime: "
                f"missing={incompatible.missing_keys}, unexpected={incompatible.unexpected_keys}"
            )
            raise RuntimeError(msg)
        with torch.no_grad():
            self.label_projection.weight.copy_(state[LABEL_WEIGHT])
            self.label_projection.bias.copy_(state[LABEL_BIAS])
            self.detect_projection.weight.copy_(state[DETECT_WEIGHT])
            self.detect_projection.bias.copy_(state[DETECT_BIAS])
        del state

    def runtime_details(self) -> RuntimeDetails:
        major, minor = torch.cuda.get_device_capability(self.device)
        return RuntimeDetails(
            python_version=platform.python_version(),
            torch_version=torch.__version__,
            transformers_version=transformers_version,
            cuda_version=torch.version.cuda or "unavailable",
            device="cuda",
            compute_capability=f"{major}.{minor}",
        )

    def _encode(self, batch: list[list[str]]) -> tuple[Tensor, Tensor, Tensor, Tensor]:
        truncated = [[START_TOKEN, *tokens[: self.parameters.max_tokens]] for tokens in batch]
        texts = [" ".join(tokens) for tokens in truncated]
        encoded = self.tokenizer(
            texts,
            add_special_tokens=False,
            return_offsets_mapping=True,
        )
        rows: list[list[int]] = []
        token_offsets: list[list[int]] = []
        for words, text, input_ids, bpe_offsets in zip(
            truncated,
            texts,
            encoded["input_ids"],
            encoded["offset_mapping"],
            strict=True,
        ):
            kept_ids, starts = encode_words(words, text, input_ids, bpe_offsets)
            rows.append(kept_ids)
            token_offsets.append(starts)

        max_pieces = max(map(len, rows))
        max_words = max(map(len, token_offsets))
        input_tensor = torch.zeros((len(rows), max_pieces), dtype=torch.long, device=self.device)
        offset_tensor = torch.zeros((len(rows), max_words), dtype=torch.long, device=self.device)
        token_mask = torch.zeros((len(rows), max_words), dtype=torch.bool, device=self.device)
        for index, (row, offsets) in enumerate(zip(rows, token_offsets, strict=True)):
            input_tensor[index, : len(row)] = torch.tensor(row, device=self.device)
            offset_tensor[index, : len(offsets)] = torch.tensor(offsets, device=self.device)
            token_mask[index, : len(offsets)] = True
        return input_tensor, input_tensor.ne(0).long(), offset_tensor, token_mask

    @torch.inference_mode()
    def _predict(self, batch: list[list[str]]) -> tuple[Tensor, Tensor, Tensor]:
        input_ids, attention_mask, offsets, token_mask = self._encode(batch)
        hidden = self.encoder(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
        batch_indexes = torch.arange(hidden.shape[0], device=self.device).unsqueeze(1)
        token_hidden = hidden[batch_indexes, offsets]
        label_probabilities = self.label_projection(token_hidden).softmax(dim=-1)
        if self.parameters.additional_confidence > 0:
            label_probabilities[:, :, 0] += self.parameters.additional_confidence
        detect_probabilities = self.detect_projection(token_hidden).softmax(dim=-1)
        error_probability = (
            detect_probabilities[:, :, self.incorrect_index]
            .masked_fill(~token_mask, 0)
            .amax(dim=-1)
        )
        probabilities, indexes = label_probabilities.max(dim=-1)
        return probabilities.cpu(), indexes.cpu(), error_probability.cpu()

    def _postprocess(
        self,
        batch: list[list[str]],
        probabilities: Tensor,
        indexes: Tensor,
        error_probabilities: Tensor,
    ) -> list[list[str]]:
        results: list[list[str]] = []
        for tokens, token_probs, token_indexes, error_probability in zip(
            batch,
            probabilities,
            indexes,
            error_probabilities,
            strict=True,
        ):
            if error_probability.item() < self.parameters.min_error_probability:
                results.append(tokens)
                continue
            edits: list[tuple[int, int, str, float]] = []
            length = min(len(tokens), self.parameters.max_tokens)
            for index in range(length + 1):
                label = self.labels[token_indexes[index].item()]
                probability = token_probs[index].item()
                if (
                    probability < self.parameters.min_token_probability
                    or label in {KEEP, PADDING, UNKNOWN}
                    or not is_actionable_label(index, label)
                ):
                    continue
                edits.append(edit_action(index, label, probability))
            results.append(apply_edits(tokens, edits, self.verb_forms))
        return results

    def correct(self, sequences: list[list[str]]) -> tuple[list[list[str]], list[int]]:
        final = [tokens.copy() for tokens in sequences]
        histories = [[tokens.copy()] for tokens in sequences]
        active = [
            index
            for index, tokens in enumerate(sequences)
            if len(tokens) >= self.parameters.min_tokens
        ]
        updates = [0 for _ in sequences]
        for _iteration in range(self.parameters.iterations):
            if not active:
                break
            next_active: list[int] = []
            for batch_start in range(0, len(active), self.parameters.batch_size):
                ids = active[batch_start : batch_start + self.parameters.batch_size]
                batch = [final[index] for index in ids]
                prediction = self._postprocess(batch, *self._predict(batch))
                for sequence_id, corrected in zip(ids, prediction, strict=True):
                    if record_prediction(sequence_id, corrected, final, histories, updates):
                        next_active.append(sequence_id)
            active = next_active
        return final, updates


def split_line(line: str) -> tuple[str, str, str, str]:
    terminator_match = re.search(r"(?:\r\n|\n|\r)$", line)
    terminator = terminator_match.group(0) if terminator_match else ""
    body = line[: -len(terminator)] if terminator else line
    leading_length = len(body) - len(body.lstrip())
    trailing_length = len(body) - len(body.rstrip())
    content_end = len(body) - trailing_length if trailing_length else len(body)
    return (
        body[:leading_length],
        body[leading_length:content_end],
        body[content_end:],
        terminator,
    )


def aligned_source_tokens(source_tokens: list[str], target_tokens: list[str]) -> dict[int, int]:
    matcher = SequenceMatcher(a=source_tokens, b=target_tokens, autojunk=False)
    target_to_source: dict[int, int] = {}
    for operation, source_start, _source_end, target_start, target_end in matcher.get_opcodes():
        if operation != "equal":
            continue
        for offset in range(target_end - target_start):
            target_to_source[target_start + offset] = source_start + offset
    return target_to_source


def source_separator(
    source: str,
    matches: list[re.Match[str]],
    target_tokens: list[str],
    target_to_source: dict[int, int],
    target_index: int,
) -> str:
    previous_source = target_to_source.get(target_index - 1)
    current_source = target_to_source.get(target_index)
    if (
        previous_source is not None
        and current_source is not None
        and current_source == previous_source + 1
    ):
        separator = source[matches[previous_source].end() : matches[current_source].start()]
    elif current_source is not None and current_source > 0:
        separator = source[matches[current_source - 1].end() : matches[current_source].start()]
    else:
        separator = " "
    if current_source is None and re.fullmatch(r"[,.;:!?%)}\]]+", target_tokens[target_index]):
        return ""
    if re.fullmatch(r"[({\[]+", target_tokens[target_index - 1]):
        return ""
    return separator


def reconstruct_segment(source: str, target_tokens: list[str]) -> str:
    matches = list(re.finditer(r"\S+", source))
    source_tokens = [match.group(0) for match in matches]
    if not target_tokens:
        return ""
    target_to_source = aligned_source_tokens(source_tokens, target_tokens)
    pieces: list[str] = [source[: matches[0].start()] if matches else ""]
    for target_index, token in enumerate(target_tokens):
        if target_index > 0:
            pieces.append(
                source_separator(
                    source,
                    matches,
                    target_tokens,
                    target_to_source,
                    target_index,
                )
            )
        pieces.append(token)
    pieces.append(source[matches[-1].end() :] if matches else "")
    return "".join(pieces)


def paragraph_segments(
    source: str,
    paragraph_start: int,
    paragraph_end: int,
    max_tokens: int,
) -> list[TextSegment]:
    paragraph = source[paragraph_start:paragraph_end]
    token_matches = list(re.finditer(r"\S+", paragraph))
    segments: list[TextSegment] = []
    offset = 0
    while offset < len(token_matches):
        limit = min(offset + max_tokens, len(token_matches))
        sentence_end = limit
        if limit < len(token_matches):
            sentence_end = next(
                (
                    index + 1
                    for index in range(limit - 1, offset, -1)
                    if re.search(r"[.!?][\]})'\"*_]*$", token_matches[index].group(0))
                ),
                limit,
            )
        first = token_matches[offset]
        last = token_matches[sentence_end - 1]
        segments.append(
            TextSegment(
                start=paragraph_start + first.start(),
                end=paragraph_start + last.end(),
                tokens=[match.group(0) for match in token_matches[offset:sentence_end]],
            )
        )
        offset = sentence_end
    return segments


class MarkdownSegmenter:
    def __init__(self, source: str, max_tokens: int) -> None:
        self.source = source
        self.max_tokens = max_tokens
        self.segments: list[TextSegment] = []
        self.paragraph_start: int | None = None
        self.paragraph_end: int | None = None
        self.in_frontmatter = source.startswith(("---\n", "---\r\n"))
        self.in_fence = False

    def flush(self) -> None:
        if self.paragraph_start is not None and self.paragraph_end is not None:
            self.segments.extend(
                paragraph_segments(
                    self.source,
                    self.paragraph_start,
                    self.paragraph_end,
                    self.max_tokens,
                )
            )
        self.paragraph_start = None
        self.paragraph_end = None

    def consume(self, line_index: int, line_match: re.Match[str]) -> None:
        line = line_match.group(0)
        if not line:
            return
        _leading, content, _trailing, _terminator = split_line(line)
        stripped = content.strip()
        if self.in_frontmatter:
            self.flush()
            if line_index > 0 and stripped == "---":
                self.in_frontmatter = False
            return
        if re.match(r"^(?:```|~~~)", stripped):
            self.flush()
            self.in_fence = not self.in_fence
            return
        if self.in_fence:
            self.flush()
            return
        list_match = re.match(r"^\s*(?:[-*+] |\d+[.)] )", line)
        contains_inline_markup = (
            "`" in content
            or re.search(r"!?\[[^\]\n]*\]\([^)]*\)", content) is not None
            or re.search(r"!?\[[^\]\n]*\]\[[^\]\n]*\]", content) is not None
            or re.search(r"<(?:https?://|mailto:)[^>\n]+>", content) is not None
        )
        structural = (
            not stripped
            or re.match(r"^(?:#{1,6}\s|\||>|<|:::)", stripped) is not None
            or re.match(r"^\[[^\]]+\]:\s", stripped) is not None
            or re.match(r"^\s{4,}\S", line) is not None
            or contains_inline_markup
        )
        if structural:
            self.flush()
            return
        content_end = line_match.start() + len(line.rstrip("\r\n "))
        if list_match:
            self.flush()
            self.paragraph_start = line_match.start() + list_match.end()
            self.paragraph_end = content_end
            return
        if self.paragraph_start is None:
            self.paragraph_start = line_match.start() + len(line) - len(line.lstrip())
        self.paragraph_end = content_end


def document_segments(source: str, max_tokens: int) -> list[TextSegment]:
    segmenter = MarkdownSegmenter(source, max_tokens)
    for line_index, line_match in enumerate(re.finditer(r"[^\n]*(?:\n|$)", source)):
        segmenter.consume(line_index, line_match)
    segmenter.flush()
    return segmenter.segments


def run_job(
    job: InferenceJob,
    model_directory: Path,
    manifest: GectorModelManifest,
    parameters: InferenceParameters,
) -> RawRun:
    model = GectorModel(model_directory, parameters, manifest.checkpoint.digest)
    artifacts = job.artifacts

    segments: list[tuple[int, TextSegment]] = []
    artifact_sources: list[str] = []
    for artifact_index, artifact in enumerate(artifacts):
        source = (
            project_path(artifact.source_file).read_text(encoding="utf-8")
            if artifact.source_file is not None
            else artifact.source_text
        )
        if source is None:
            msg = f"inference artifact {artifact.artifact_id} has no source"
            raise RuntimeError(msg)
        artifact_sources.append(source)
        segments.extend(
            (artifact_index, segment)
            for segment in document_segments(source, parameters.max_tokens)
        )

    corrected, updates = model.correct([segment.tokens for _artifact, segment in segments])
    corrected_lines: list[list[int]] = [[] for _artifact in artifacts]
    update_counts = [0 for _artifact in artifacts]
    replacements: list[list[tuple[int, int, str]]] = [[] for _artifact in artifacts]
    for segment_index, ((artifact_index, segment), target_tokens) in enumerate(
        zip(segments, corrected, strict=True),
    ):
        if segment.tokens == target_tokens:
            continue
        segment_source = artifact_sources[artifact_index][segment.start : segment.end]
        replacements[artifact_index].append(
            (segment.start, segment.end, reconstruct_segment(segment_source, target_tokens))
        )
        corrected_lines[artifact_index].append(
            artifact_sources[artifact_index].count("\n", 0, segment.start) + 1
        )
        update_counts[artifact_index] += updates[segment_index]

    results: list[RawArtifact] = []
    for index, artifact in enumerate(artifacts):
        generated = artifact_sources[index]
        for start, end, replacement in sorted(replacements[index], reverse=True):
            generated = f"{generated[:start]}{replacement}{generated[end:]}"
        results.append(
            RawArtifact(
                artifactId=artifact.artifact_id,
                generatedText=generated,
                correctedLines=corrected_lines[index],
                iterationUpdates=update_counts[index],
            )
        )
    return RawRun(
        model=RawModelIdentity(
            modelId=manifest.metadata.descriptor.name,
            sourceRevision=manifest.metadata.descriptor.revision,
            checkpointContentHash=manifest.checkpoint.digest,
        ),
        runtime=model.runtime_details(),
        parameters=parameters,
        artifacts=tuple(results),
    )


def serialized_result(result: RawRun) -> str:
    value = result.model_dump(mode="json", by_alias=True)
    return f'{json.dumps(value, sort_keys=True, separators=(",", ":"))}\n'


def write_runtime_smoke_result(result: RawRun) -> None:
    RUNTIME_SMOKE_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with RUNTIME_SMOKE_OUTPUT.open("w", encoding="utf-8", newline="\n") as output:
        output.write(serialized_result(result))


def write_adapter_smoke_result(result: RawRun) -> None:
    ADAPTER_SMOKE_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with ADAPTER_SMOKE_OUTPUT.open("w", encoding="utf-8", newline="\n") as output:
        output.write(serialized_result(result))


def write_cohort_result(result: RawRun) -> None:
    COHORT_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with COHORT_OUTPUT.open("w", encoding="utf-8", newline="\n") as output:
        output.write(serialized_result(result))


def run(mode: str) -> None:
    validated_mode = RuntimeCommand(mode=mode).mode
    RuntimeSettings()
    if validated_mode == "runtime-smoke":
        job = RUNTIME_SMOKE.job
    elif validated_mode == "adapter-smoke":
        job = frozen_job(ADAPTER_SMOKE_ARTIFACT)
    else:
        job = frozen_job()
    result = run_job(
        job,
        MODEL_DIRECTORY,
        read_model(MODEL_MANIFEST, GectorModelManifest),
        read_model(PARAMETERS_FILE, PipelineParameters).producers.gector,
    )
    if validated_mode == "runtime-smoke":
        if result.artifacts != (RUNTIME_SMOKE.expected,):
            msg = "smoke output does not match the pinned expected correction"
            raise RuntimeError(msg)
        write_runtime_smoke_result(result)
    elif validated_mode == "adapter-smoke":
        write_adapter_smoke_result(result)
    else:
        write_cohort_result(result)
    print(f"Ran GECToR over {len(result.artifacts)} artifact(s) on CUDA")


def main(command: Sequence[str] | None = None) -> None:
    fire.Fire(run, command=list(command) if command is not None else None, name="gector-runtime")


if __name__ == "__main__":
    main()
