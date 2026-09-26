# Writing editor evaluation

This DVC project turns pinned Git revisions into a reproducible writing corpus,
runs detection-only checks, and aligns their findings with observed published
edits.

`extract_dataset` reads `corpus-manifest.json`. Each entry names the document's
current repository path, a full source commit, and a full published commit.
Optional `sourcePath` and `publishedPath` fields locate historical blobs when a
document moved after those commits. The extractor verifies that both commits
exist, checks that the source precedes the published revision, loads the exact
Git blobs, rejects unchanged pairs, and records SHA-256 hashes. It validates
every entry before replacing the current output directory.

The committed seed has nine public examples from the repository's Vale cleanup:
five ADRs and four project pages. The extracted text lives in DVC, not Git.
Private drafts can join later without changing that storage boundary.

`freeze_cohort` assigns each artifact to train, validation, or holdout using a
seeded hash. It allocates each artifact type separately, so the current
validation and holdout sets both contain an ADR and a project page. The frozen
cohort ID covers the dataset, parameters, and exact membership.

The readiness report stays red until every artifact has a recorded edit
outcome. Git diffs show what changed, but they do not prove whether the author
accepted, rejected, or changed a native editor suggestion. Treating the
published text as blanket acceptance would corrupt the evaluation before it
starts.

The Vale producer runs the binary version pinned in `params.yaml` against every
frozen source artifact with the repository's merge-blocking Unslop rules. It
writes stable finding IDs, rule provenance, severity, line and column positions,
and exact UTF-8 source spans to `outputs/producers/vale.json`. The producer
hashes the Vale config and rule directory into its version, so a rule change
creates new finding identities and invalidates the DVC stage. The producer
disables Vale's finding-based exit code, fails on process errors, and enforces
the timeout in `params.yaml`.

DVC invokes each stage through a checked-in shell script. Stage dependencies
cover the script, source, lockfile, parameters, and data inputs, but exclude the
root `.mise.toml`; unrelated development-tool changes must not invalidate the
writing pipeline cache.

Vale reports normalized text when Markdown markup occurs inside a match. The
producer keeps that report beside the exact marked-up source bytes. It fails on
stale source hashes, invalid locations, an unexpected Vale version, or output
that does not satisfy the runtime schema.

The `prepare_gector_model` stage acquires Grammarly's official GECToR-2024
RoBERTa-large checkpoint without putting it in Git. The committed model
manifest pins the upstream repository commit, download URL, exact byte count,
and SHA-256 content hash. It also pins the RoBERTa tokenizer and config plus the
GECToR edit and verb vocabularies by repository revision, size, and SHA-256.
Downloads resume after an interruption. The stage rejects any file whose size
or digest does not match and writes a deterministic receipt beside the model.

The metadata follows ModelPack v0.0.7: the checkpoint is a raw model-weight
layer, the tokenizer and GECToR vocabularies are raw weight-configuration
layers, and the embedded config lists the ordered layer digests. DVC remains
the store and resolver. This file provides ModelPack-compatible metadata. It
becomes a published ModelPack package after an OCI export materialises the same
blobs in an image layout or registry and generic ModelPack tooling can pull it.

The upstream checkpoint does not state a license. Keep it restricted to this
evaluation project and its private DVC remote until that ambiguity is resolved.
`run_gector` uses a Python 3.12 environment locked by `uv.lock`. PyTorch 2.11.0
comes from the CUDA 12.8 wheel index and runs on the laptop's RTX 40-series
GPU. The adapter loads the old state dict with `weights_only=True`, maps its
RoBERTa and projection keys into current Transformers modules, and imports no
AllenNLP code. Inference stays offline after DVC restores the model directory.

The producer skips frontmatter, headings, tables, HTML, and fenced or indented
code. It joins hard-wrapped prose before inference and divides it at sentence
boundaries when a segment exceeds the model's 50-token limit. Unchanged source
whitespace remains intact. The generated Markdown and the producer run live
under `outputs/producers/gector`, which DVC owns.

The TypeScript boundary converts the generated revision into exact UTF-8 edit
spans. It creates ADR 003 suggestions with stable IDs and full model
provenance, then groups edits from the same source line into proposals. Before
writing output, it verifies each proposal against the frozen source and checks
that applying all suggestions recreates the generated Markdown byte for byte.

Vale records are findings because the active rules identify passages but
cannot rewrite them safely. They contain no replacement text. A later rewrite
producer may turn selected findings into suggestions and proposals. GECToR is
already a rewrite producer, so its actionable edits use suggestions and
proposals directly.

`match_edits` compares each source and published revision as Unicode code
points, then records the resulting edits as exact UTF-8 byte ranges. It labels a
finding `changed` when every overlapping edit stays inside its source span and
maps the whole span to its observed published text. It labels a finding
`unchanged` when no edit touches it. An edit that crosses the span, or an
insertion exactly on its boundary, becomes `manual-adjudication-required`.

The match output contains evidence about the final document, not an editorial
decision. It does not claim that a change accepted a Vale suggestion: Vale did
not provide a replacement, and the Git history does not record that decision.
The matcher verifies both revision hashes, the producer run and cohort, every
finding span, and its own runtime schema before writing
`outputs/matched/vale.json`.

On the initial cohort, 15 of 43 findings map to self-contained published
changes. The remaining 28 cross or touch finding boundaries and stay in the
manual-adjudication queue. The cohort intentionally contains no unchanged
findings because it was sampled from a Vale cleanup commit.

Run the implemented stages directly:

```bash
mise run //ml-pipelines/writing-editor-evaluation:extract
mise run //ml-pipelines/writing-editor-evaluation:freeze
mise run //ml-pipelines/writing-editor-evaluation:run:vale
mise run //ml-pipelines/writing-editor-evaluation:run:gector:smoke
mise run //ml-pipelines/writing-editor-evaluation:run:gector
mise run //ml-pipelines/writing-editor-evaluation:match:edits
```

Run `runtime:smoke` first on a newly provisioned GPU laptop. It loads the real
checkpoint and verifies a known grammatical correction. `run:gector:smoke`
then exercises one frozen ADR through the ADR 003 adapter. Only after those
checks should `run:gector` reproduce the full frozen cohort.

On the GPU laptop, download, verify, and upload the checkpoint to the private
DVC remote in one command:

```bash
mise run //ml-pipelines/writing-editor-evaluation:model:publish
```

The command needs the repository's ML-pipeline Doppler access for the DVC push.
It updates `dvc.lock`; commit that change after the upload so later clean
checkouts can use the normal `pull` task instead of downloading from upstream.

With access to the ML pipeline credentials, reproduce them through DVC:

```bash
mise run //ml-pipelines/writing-editor-evaluation:repro
```

The GECToR output remains a baseline, not evidence that the published revision
accepted a model proposal. The separate diff-alignment stage can compare model
suggestions with recorded outcomes once those outcomes exist.
