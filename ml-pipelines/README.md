# ML Pipelines

ML projects in this directory use [DVC](https://dvc.org/) to version data,
with a shared private Cloudflare R2 bucket (`dvc`) as remote storage.
Each project stores data under its own prefix (e.g. `s3://dvc/recipe-parsing`).

The `pathologize-data-registry` is the exception: it reconstructs its bounded
raw subset from allowlisted public sources and has no R2 remote. Use its
`acquire` or `repro` task; do not run the shared `pull` or `push` workflow for
that project.

Current projects:

- `ai-review-evaluation`: versioned Pull Request replay corpora, controlled
  reviewer experiments, and DuckDB decision scorecards.
- `financial-document-idp-evaluation`: synthetic financial-document extraction,
  normalization, reconciliation, abstention, and release-gate evaluation.
- `pathologize-benchmark-contracts`: pathology manifests, leakage checks,
  registry references, deterministic adapters, metrics, and scorecard schemas.
- `pathologize-slide-quality-benchmark`: tissue segmentation, artifact quality,
  artifact-free tissue, and slide rejection.
- `pathologize-tiling-benchmark`: tissue-aware tiling and physical-scale policy.
- `pathologize-cell-analysis-benchmark`: nucleus detection, instance
  segmentation, and synthetic cell classification.
- `pathologize-data-registry`: public computational-pathology source assets,
  provenance, licences, identities, scanner metadata, and source-native labels.
- `recipe-parsing`: image extraction, normalization, canonicalization, and
  evaluation.
- `recipe-dataset`: acquisition and preparation of reusable recipe text
  corpora for site seeding and future parsing evaluation.
- `wsi-analysis`: versioned computational-pathology source slides and derived
  tile datasets, with Python tooling for validation and WSI tiling.
- `writing-editor-evaluation`: Git-revision writing pairs, frozen evaluation
  cohorts, producer outputs, edit matching, and writing-quality scorecards.

Python projects share deterministic JSON, hashing, and safe path helpers through
`packages/data-artifacts`. Evaluation projects add domain-neutral contracts,
resource gates, adapter loading, and schema writing through
`packages/ml-evaluation`.

## Prerequisites

DVC is supplied by mise through `uv`, so no manual install is needed. The
`dvc` task and its wrappers below resolve it on first use.

You do need the [Doppler CLI](https://docs.doppler.com/docs/install-cli)
installed and authenticated, since it injects the credentials.

## Credentials Setup

Secrets come from the Doppler config `dev_ml_pipelines`, injected by
`scripts/doppler-pipeline-env.sh`. It holds:

- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`. DVC remote access. The wrapper
  maps them to the `AWS_*` names DVC's S3 remote reads, matching how CI maps
  them.
- `OPENROUTER_API_KEY`. The LLM stages.

You need an R2 API token for the credentials themselves.
Go to [Cloudflare R2](https://dash.cloudflare.com/?to=/:account/r2/overview) →
Manage R2 API Tokens to create one.

**For local development**, Create a **User API Token**:

1. Permissions: **Object Read & Write**
2. Specify bucket: `dvc`
3. Put the **Access Key ID** and **Secret Access Key** into Doppler
   `dev_ml_pipelines`

**For CI (GitHub Actions)**, Create an **Account API Token**:

1. Permissions: **Object Read**
2. Specify bucket: `dvc`
3. Add the credentials to Doppler `prd_ci_repo`, then run
   `scripts/sync-doppler-github-envs.sh` to mirror them into the
   `production-ci` GitHub environment

Note: The R2 endpoint URL is hardcoded in each project's `.dvc/config`
since DVC doesn't support environment variable substitution in config files.

## Common DVC Workflows

Each project exposes `pull`, `repro`, and `push` mise tasks, runnable from
anywhere in the repo. recipe-parsing also defines a passthrough `dvc` task;
from other pipeline directories, use the shared parent task instead:

```bash
mise run //ml-pipelines/recipe-parsing:pull
mise run //ml-pipelines/recipe-parsing:push
mise run //ml-pipelines/recipe-parsing:dvc -- status
mise run //ml-pipelines:dvc -- status   # from ml-pipelines/recipe-dataset
```

When adding data, `dvc add` autostages the tracking file; commit it, then push
the data to R2.

## Git and DVC boundary

- Keep compact, human-reviewable text contracts in Git: source and licence
  manifests, schemas, parameters, predeclarations, and concise reports.
- Keep raw source data, private evidence, binary artifacts, models, and large or
  high-cardinality generated outputs in the DVC cache and configured remote.
- Declare every generated artifact in its producing DVC stage. For compact text
  that must remain visible in Git, use a non-cached DVC output or metric so the
  lockfile still detects drift. Do not leave generated evidence undeclared.
- Public availability does not make source bytes suitable for Git. Record their
  stable identities, rights, byte counts, and checksums in Git-tracked manifests
  and keep the bytes in DVC.
