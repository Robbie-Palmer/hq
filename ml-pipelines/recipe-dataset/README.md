# Recipe Dataset Pipeline

This DVC project acquires, normalizes, and measures reusable recipe corpora for
site seeding and future recipe-parsing experiments. Its Cloudflare R2 remote is
isolated at `s3://dvc/recipe-dataset`.

## Sources

The machine-readable catalog is [`sources.json`](sources.json). The current raw
dataset contains:

- 62,126 declared-CC0 recipes from the Kaggle 64k dataset.
- 1,072 preserved USDA MyPlate Kitchen recipes with Recipe JSON-LD and
  nutrition metadata.
- 3,895 Wikibooks Cookbook records under CC BY-SA 4.0.
- 127 Project Gutenberg cookbook texts from the Cookbooks and Cooking
  bookshelf.
- A pinned 21-recipe CC0 FOSS Recipes source archive.
- 664 Child Nutrition Recipe Box records from the Institute of Child
  Nutrition, preserving each recipe's first-party URL and attribution.
- Six CC0 recipes from a pinned Koha Cookbook revision.
- 1,412 Cooklang files from 11 pinned Apache 2.0, MIT, and CC0 recipe
  repositories. The original Cooklang source is retained alongside normalized
  ingredients, instructions, equipment, metadata, and upstream provenance.
- 16,644 CC0 tastyR rows with ingredients and metadata. Because these rows do
  not contain instructions, they are kept separately as ingredient-only data.
- The pinned Open Recipes source and its current historical dump. The latest
  published dump is an empty gzip file, but it is retained for provenance.

The prepared dataset contains 69,118 complete structured recipes and a
32,012-row canonical content view. It also contains 10,464 conservative
Gutenberg recipe-boundary candidates for future extraction evaluation. These
candidates are not promoted as complete recipes until their boundaries and
fields can be evaluated. Its 78 rejects comprise 71 Wikibooks records whose
source snapshot has no ingredient items and seven empty, metadata-only, or TODO
Cooklang files; they remain in `outputs/rejects.jsonl` as parser evaluation and
regression fixtures.

Equipment is part of the normalized recipe model. The current corpus preserves
6,460 equipment items across 1,815 Cooklang, FOSS, and Wikibooks recipes. Other
adapters can populate the same field whenever their source exposes equipment
explicitly.

## Kaggle duplicate structure

The Kaggle archive contains 62,126 unique source rows, but only 25,021 unique
recipe-content signatures. Those 14,353 repeated-content groups account for
37,105 excess rows. Almost all of this is category expansion: the same
title, ingredients, and instructions are repeated once per category while the
category metadata differs. The stats stage therefore writes both the lossless
source-shaped `recipes.jsonl` and `recipes-deduplicated.jsonl`, which merges
categories and retains every source variant. The Kaggle listing exposes one
discussion topic, but neither its public metadata nor indexed discussion text
documents this duplicate/category behavior.

## Pipeline

```text
source catalog -> download -> data/raw
                            -> prepare -> complete recipes + rejects
                                       + ingredient-only rows
                                       + Gutenberg boundary candidates
                            -> stats -> canonical recipes + metrics + plot
```

Each prepared row includes source dataset, record ID, URL, declared license,
retrieval date, source checksum, and normalized-content signature. This supports
idempotent database loading and both exact-content and title-level deduplication.
The acquisition date lives in tracked `snapshot.json`; update it when refreshing
the raw corpus, so reproducing an existing snapshot remains deterministic.

Run the complete pipeline from this directory:

```bash
mise x -- dvc repro
```

Or use the project tasks while developing an individual stage:

```bash
mise //ml-pipelines/recipe-dataset:download
mise //ml-pipelines/recipe-dataset:prepare
mise //ml-pipelines/recipe-dataset:stats
mise //ml-pipelines/recipe-dataset:check
mise //ml-pipelines/recipe-dataset:push
```

## R2

For local pushes, add `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` to the
`personal-site` project's `dev_ml_pipelines` Doppler config. The access-key ID
may be unmasked; keep the secret access key masked. Then run:

```bash
mise //ml-pipelines/recipe-dataset:push
```

The task injects that Doppler config through `../scripts/doppler-pipeline-env`,
which maps the `R2_*` names onto the `AWS_*` ones DVC reads. Credentials
already set in the environment take precedence.

The committed `dvc.lock` identifies the exact raw and derived dataset versions;
`dvc pull` restores them without reacquiring upstream sites.
Pull-request CI runs that pull in a clean environment, so the check fails when
any object referenced by the lock file is absent from R2.

## Future shared parsing work

FOSS Markdown and Koha reStructuredText now convert into the same normalized row
shape as the structured sources. The next extraction stage should label and
evaluate Gutenberg candidate boundaries before promoting them. The
`ingredientGroups`, `instructions`, and `equipment` fields intentionally align
with shared `recipe-parsing` artifacts, so Cooklang and schema.org Recipe
normalization, canonicalization, retry accounting, and evaluation metrics can
move into shared pipeline utilities rather than being reimplemented here.
