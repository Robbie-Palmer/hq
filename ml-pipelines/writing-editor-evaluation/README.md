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

The readiness report stays red until every artifact has a validated outcome
record. Git diffs show what changed, but they do not prove whether the author
accepted, rejected, or changed a native editor suggestion. The
`finalize_cohort_readiness` stage turns the report green only after the private
decision evidence covers all nine frozen artifacts and passes source, proposal,
decision, and receipt validation.

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
`run_gector` uses a Python 3.14 environment locked by `uv.lock`. PyTorch 2.13.0
comes from the CUDA 12.6 wheel index and runs on the laptop's RTX 40-series
GPU. The adapter loads the old state dict with `weights_only=True`, maps its
RoBERTa and projection keys into current Transformers modules, and imports no
AllenNLP code. Inference stays offline after DVC restores the model directory.

The producer skips frontmatter, headings, tables, HTML, and fenced or indented
code. It also skips inline Markdown formatting, inline HTML, and JavaScript
template literals such as Mermaid component bodies. It joins hard-wrapped prose
before inference and divides it at sentence boundaries when a segment exceeds
the model's 50-token limit. Unchanged source whitespace remains intact. The
generated Markdown and the producer run live under `outputs/producers/gector`,
which DVC owns.

Two current-worktree pilots extend the historical cohort without pretending an
uncommitted snapshot is a Git revision. Their content-addressed revision starts
with `worktree:` and covers every selected path and source hash. The customer
corpus contains 89 blog posts, ideas, initiatives, project pages, and pitches.
The developer corpus contains 220 ADRs and 93 first-party guides, runbooks, and
package documents. It excludes mirrored skills, vendored and third-party text,
data licences, and upstream source snapshots.

Each audience has a deterministic 20-document calibration cohort. DVC runs the
baseline, balanced, and strict confidence profiles before applying the strict
profile to the full corpus. The reports preserve proposal volume by content
kind and the highest-volume review targets. All model output remains
review-only.

The TypeScript boundary converts the generated revision into exact UTF-8 edit
spans. It creates ADR 003 suggestions with stable IDs and full model
provenance, then groups edits from the same source line into proposals. Before
writing output, it verifies each proposal against the frozen source and checks
that applying all suggestions recreates the generated Markdown byte for byte.

Vale remains the detection layer. Every Unslop rule is classified as either
finding-only or safely rewritable. The repository review command turns only
the allowlisted exact replacements into ADR 003 suggestions and proposals;
ambiguous alerts stay findings without replacement text. GECToR is also a
rewrite producer, so its actionable edits use suggestions and proposals
directly.

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

`record_gector_decisions` compares proposals from the pinned pre-edit source
with the reviewed corpus. It writes accepted, rejected, or changed decisions
that embed the exact proposal. Each artifact also carries its source-before and
decision-applied source-after bytes, a decision log, and a receipt that hashes
all four. A source change that crosses a proposal boundary is rejected rather
than treated as an inferred editorial outcome. Vale findings remain detection
coverage and never become invented proposal decisions.

The broad pilot records 411 proposal outcomes: 87 accepted, 9 changed, and 315
rejected. The frozen seed contributes 81 explicitly rejected GECToR proposals;
its published revisions did not contain the model's exact changes. The current
customer and developer corpora contribute the accepted and changed examples.
Their deterministic train, validation, and holdout labels are stored with the
evidence. The holdout split is evaluation-only and must not be used to tune
thresholds or train a later model.

`evaluate_reviews` revalidates source bytes, embedded proposals, decisions,
decision-applied output, and receipts before calculating outcomes. Detection
coverage stays separate from proposal yield. The scorecard reports factual,
terminology, voice, regression, review-time, and useful-yield measures for each
artifact, with source hashes, revisions, producer IDs, and evidence hashes.
Thresholds live in `evaluation-params.json`; every gate must pass before the
recommendation can change from `keep-opt-in` to `adopt-default`. This pilot
stays `keep-opt-in`: review duration was not measured, quality preservation was
not independently assessed, and useful yield was 23.4%.

The repository pilot and future private cohorts live in the project's DVC data
area. Git tracks only their DVC pointers. Each evidence manifest records its
classification, consent, retention, and deletion status. A deletion request
blocks adoption even when the numerical thresholds pass.

If a reviewed file moves after the pinned baseline, map its baseline artifact
ID to the current artifact ID in `targetRenames` in
`review-decision-config.json`. The recorder resolves that map before reading
the reviewed target while keeping the baseline ID in the evidence record.

To honour a deletion request, first add the evidence artifact ID and request
time to `deletionRequests` in `review-decision-config.json`. Reproduce the
scorecard so the adoption gate and frozen readiness fail. After approval, move
the ID to `deletedArtifacts` with its request and deletion times. The recorder
then omits the source, records, decisions, and receipt, and keeps a non-content
tombstone in the manifest. Reproduce and commit the new DVC lock. After every
retained branch, tag, and commit has been audited for references to the deleted
object, a repository owner can purge unreferenced objects from the private
remote with:

```bash
mise run //ml-pipelines/writing-editor-evaluation:dvc -- gc --cloud --all-branches --all-tags --all-commits --force
```

Remote garbage collection can remove other unreferenced pipeline objects, so
it requires an explicit owner-approved deletion window and a current backup.

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
mise run //ml-pipelines/writing-editor-evaluation:run:gector:current
mise run //ml-pipelines/writing-editor-evaluation:run:gector:developer
mise run //ml-pipelines/writing-editor-evaluation:match:edits
mise run //ml-pipelines/writing-editor-evaluation:evaluate:reviews
mise run //ml-pipelines/writing-editor-evaluation:record:gector:decisions
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

The raw GECToR output remains a baseline, not an editorial outcome. Only the
separate governed decision stage can add a proposal to the evaluation dataset.

The initial 2026-10-18 CUDA run processed all nine frozen artifacts on an RTX
4080 and returned 247 suggestions in 159 proposals across seven artifacts.
After adding the Markdown, MDX, and template-literal protections discovered in
review, the same cohort produces 114 suggestions in 81 proposals. Manual review
found a small number of useful article, preposition, and pronoun corrections,
but most proposals damaged Markdown, technical terms, brand names,
contractions, or sentence meaning. The run supports keeping GECToR as a lower
bound rather than adopting it as the editor's model layer.

The broader pilot used the same GPU on 402 first-party documents from the
pinned pre-edit revision. At the strict threshold, it produced 106 proposals
across 89 customer documents and 224 across 313 developer documents. Manual
review applied dozens of narrow corrections while rejecting unsafe or
meaning-changing rewrites.
The result confirms that stricter thresholds and Markdown-aware segmentation
reduce noise, but do not make GECToR suitable for unattended editing.
