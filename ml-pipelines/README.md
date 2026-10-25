# ML Pipelines

ML projects in this directory use [DVC](https://dvc.org/) to version data,
with a shared private Cloudflare R2 bucket (`dvc`) as remote storage.
Each project stores data under its own prefix (e.g. `s3://dvc/recipe-parsing`).

Current projects:

- `ai-review-evaluation`: versioned Pull Request replay corpora, controlled
  reviewer experiments, and DuckDB decision scorecards.
- `recipe-parsing`: image extraction, normalization, canonicalization, and
  evaluation.
- `recipe-dataset`: acquisition and preparation of reusable recipe text
  corpora for site seeding and future parsing evaluation.
- `wsi-analysis`: versioned computational-pathology source slides and derived
  tile datasets, with Python tooling for validation and WSI tiling.
- `writing-editor-evaluation`: Git-revision writing pairs, frozen evaluation
  cohorts, producer outputs, edit matching, and writing-quality scorecards.

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
