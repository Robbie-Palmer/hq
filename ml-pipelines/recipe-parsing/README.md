# Recipe parsing

ML pipeline for parsing recipe images.

See the [ml-pipelines README](../README.md) for DVC setup and credentials.

## Data

Recipe images are tracked by DVC in `data/recipe-images/`. After setting up credentials:

```bash
mise //ml-pipelines/recipe-parsing:pull
mise //ml-pipelines/recipe-parsing:push
```

The parsing algorithm itself (prompts, OpenRouter calls, Cooklang handling,
canonicalization, and the canonical ingredient and equipment registries) lives
in the shared [`recipe-parsing` package](../../packages/recipe-parsing/), which
the production ingestion backend also consumes. This pipeline owns dataset
management, stage orchestration, and evaluation.

## Synthetic URL-import corpus

`data/url-import-corpus/synthetic/v1/` contains only project-authored synthetic
HTML fixtures and reviewed ground truth. It is deterministic regression data,
and it does not qualify as a real-world holdout or support claims about
generalization to live recipe sites. The catalog, manifests, validation report,
and replay report all encode that limitation.

Every fixture is licensed with this repository under AGPL-3.0-only. Each
manifest records a reserved `.invalid` source URL, fixed retrieval metadata,
storage and evaluation rights, SHA-256 content hashes, expected parser fields,
and review status. No task fetches a live recipe page.

The synthetic corpus has train, development, and regression manifests. The
regression partition contains targeted known failures, including the focaccia
case. It is explicit, non-gating evaluation data until those failures are
fixed. It is not sealed or untouched. Source groups and markup pattern families
cannot cross partitions.

Validate the complete synthetic corpus and replay the currently passing train
and development fixtures:

```bash
mise //ml-pipelines/recipe-parsing:url-import:validate
mise //ml-pipelines/recipe-parsing:url-import:replay
```

Run the complete deterministic baseline with one offline command:

```bash
mise //ml-pipelines/recipe-parsing:url-import:baseline
```

The command runs the shared schema.org and DOM extraction path, Cooklang
normalization, quantity and unit parsing, step segmentation, and deterministic
ingredient and equipment ontology matching. It reads saved train and
development snapshots only. The regression partition is not a dependency, so
routine evaluation does not inspect or tune against its known failures.

The command writes three stable JSON reports under `outputs/`:

- `url-import-deterministic-baseline.json` has field precision and recall,
  usable-import rate, ontology coverage, and source strata.
- `url-import-deterministic-failures.json` lists failures by category and
  fixture.
- `url-import-regression-gate.json` records the declared budgets and any
  violations.

`config/url-import-deterministic-baseline.json` pins the corpus 1.0.0 reference.
The current reference allows no drop in usable-import rate, ontology coverage,
or field precision and recall, and no increase in categorized failures. The
three existing unmatched ontology terms remain explicit baseline failures.
Content hashes for the selected corpus files, parser code, ontology data,
configuration, and lockfile form the local cache key. DVC also caches and diffs
the reports through the `evaluate_url_import_baseline` stage. CI runs the same
mise command and fails when the gate reports a violation.

The matching DVC stages are `validate_url_import_corpus` and
`replay_url_import_corpus`. The baseline adds
`evaluate_url_import_baseline`. Validation checks all three synthetic
partitions. The gating replay and baseline stages list only the currently
passing train and development partitions as dependencies. Reproduce all local
URL-import stages and update `dvc.lock` with:

```bash
mise //ml-pipelines/recipe-parsing:url-import:repro
```

Replay only the known-failure regression partition while debugging with the
following task. It exits nonzero while a fixture differs from ground truth and
still writes its diagnostic report.

```bash
mise //ml-pipelines/recipe-parsing:url-import:replay-regression
```

A future real-world evaluation corpus must use a separate path and schema. It
should freeze permitted HTML bytes before parser inspection, split by publisher
or source group, record rights and retrieval evidence, and stay outside routine
development replay. The recipe-dataset project can supply source candidates,
but its structured recipe records are not substitutes for immutable page HTML.

## Pipeline stages

### 1. Parse

`parse` runs multimodal recipe extraction through OpenRouter using the OpenAI SDK.

Required environment variables:

- `OPENROUTER_API_KEY`

Optional environment variables:

- `OPENROUTER_MODEL` (default: `google/gemini-3-flash-preview`)
- `PARSE_REQUEST_TIMEOUT_MS` (default: `30000`)
- `PARSE_MAX_RETRIES` (default: `2`)
- `PARSE_CONCURRENCY` (default: `8`)
- `PARSE_RETRY_BASE_DELAY_MS` (default: `500`)
- `PARSE_RETRY_MAX_DELAY_MS` (default: `8000`)
- `PARSE_IMAGE_MAX_DIM` (default: `1600`)
- `PARSE_IMAGE_JPEG_QUALITY` (default: `80`)

`parse.ts` loads environment variables from a local `.env` file automatically
(using `dotenv`), so project-specific settings can live in
`ml-pipelines/recipe-parsing/.env`.

Outputs:

- `outputs/structured-extractions.json`: image -> structured text extraction artifacts
- `outputs/cooklang-recipes.json`: generated Cooklang artifacts plus derived previews
- `outputs/predictions.json`: successful derived normalized recipes for downstream compatibility
- `outputs/parse-failures.json`: skipped entry diagnostics after retry exhaustion

The parse stage now runs as a staged ingestion flow:

1. image -> structured extraction artifact
2. structured extraction -> Cooklang artifact
3. Cooklang artifact -> derived normalized recipe

`predictions.json` remains a downstream-compatible derived view, not the
canonical intermediate artifact.

### 2. Evaluate extraction

`evaluate_extraction` compares raw parser output against `expectedExtraction` ground
truth annotations. This measures how well the parser reads recipe images before
any canonicalization. Entries without `expectedExtraction` are skipped.

Outputs:

- `outputs/extraction-metrics.json`: aggregate extraction quality metrics
- `outputs/extraction-per-image-scores.json`: per-entry extraction scores

### 3. Dataset stats

`dataset_stats` summarizes the prepared dataset for reporting through DVC
metrics and plots.

Outputs:

- `outputs/dataset-stats.json`: headline dataset counts and top categories
- `outputs/images-per-recipe-histogram.json`: plot data for recipe frequency by image count
- `outputs/cuisine-distribution.json`: plot data for cuisine frequency
- `outputs/top-ingredients.json`: plot data for most common ingredients

### 4. Canonicalize

`canonicalize` maps parsed ingredient slugs to the canonical ingredient registry
in `packages/recipe-parsing/src/data/canonical-ingredients.json`, and cookware
names to the canonical equipment registry in
`packages/recipe-parsing/src/data/canonical-equipment.json`.

Both registries are matched the same way: rule-generated candidates (modifier
stripping, singular/plural forms, aliases) are checked for an exact registry
hit, then scored fuzzily against the registry with a threshold and a margin over
the runner-up. Anything still unresolved with plausible candidates is handed to
the LLM disambiguation pass, which picks from those candidates only.

Outputs:

- `outputs/predictions-canonicalized.json`: predictions with canonical ingredient slugs and equipment names
- `outputs/canonicalization-decisions.json`: per-ingredient and per-cookware canonicalization decisions

### 5. Evaluate

`evaluate` compares canonicalized predictions against `expected` (canonical)
ground truth. This is the end-to-end metric.

Outputs:

- `outputs/metrics.json`: aggregate end-to-end metrics
- `outputs/per-image-scores.json`: per-entry end-to-end scores
- `outputs/per-entry-score-plot.json`: flat plot data for DVC score charts

## Running the pipeline

Prefer DVC orchestration over manually chaining every script.

Run the core pipeline end-to-end:

```bash
dvc repro prepare dataset_stats parse evaluate_extraction canonicalize evaluate
```

Run an individual stage:

```bash
dvc repro parse
```
