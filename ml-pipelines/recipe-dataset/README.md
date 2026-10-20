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

The prepared dataset contains 69,118 complete structured recipes and 16,644
ingredient-only recipes in the versioned extraction model. The existing
complete-recipe view has a 32,012-row canonical content view. The dataset also
contains 10,464 conservative
Gutenberg recipe-boundary candidates for future extraction evaluation. These
candidates are not promoted as complete recipes until their boundaries and
fields can be evaluated. Its 78 rejects comprise 71 Wikibooks records whose
source snapshot has no ingredient items and seven empty, metadata-only, or TODO
Cooklang files; they remain in `outputs/rejects.jsonl` as parser evaluation and
regression fixtures.

Equipment is part of the extracted recipe model. The current corpus preserves
6,460 equipment items across 1,815 Cooklang, FOSS, and Wikibooks recipes. Other
adapters can populate the same field whenever their source exposes equipment
explicitly.

## Extracted recipe model

`outputs/extracted-recipes.jsonl` is the adapter boundary between third-party
datasets and the product recipe domain. Each row uses schema version 1 from
[`src/lib/extracted-recipe.mjs`](src/lib/extracted-recipe.mjs). The model keeps
source text intact and records structure only when the source states it:

- provenance, license, checksum, retrieval date, format, and pinned revision;
- complete or ingredient-only status;
- named ingredient and instruction sections;
- ingredient, equipment, and timer text, plus stated name, quantity, unit, and
  note fields when the source supplies them;
- cuisine, category, tags, servings and alternate yields, times, difficulty, authorship, images,
  notes, ratings, and nutrition metadata.

The extraction stage does not convert ingredients to product slugs, normalize
units, infer equipment from prose, or coerce serving and time text into product
types. The following `adapt-product` stage makes those decisions through the
shared `recipe-parsing` package. `outputs/recipes.jsonl` remains the compatible
complete-recipe view used by the current stats and deduplication stage.

## Product adapter

`outputs/product-recipes.jsonl` contains the product-domain adaptation report
for every complete recipe. It includes the validated `ParsedRecipe`, its
Cooklang representation, source provenance, diagnostics, and a list of source
fields that the current product domain does not represent. The adapter maps
ingredient sections, instructions, cuisine, servings, prep and cook time, and
explicit equipment. It also maps source tags and the canonical source URL into
Cooklang frontmatter.

`outputs/product-adapter-skips.jsonl` retains ingredient-only rows rather than
inventing instructions. `outputs/product-adapter-metrics.json` counts adapted,
skipped, invalid, and unadaptable rows and shows how often each source field is
not represented by the product model. The current snapshot adapts all 69,118
complete recipes and retains 16,644 ingredient-only rows as explicit skips.

The `canonicalize-product` stage then maps ingredient slugs and equipment names
through the same deterministic registries and matching rules used by recipe
ingestion. It writes `outputs/product-recipes-canonicalized.jsonl` for loading,
`outputs/product-canonicalization-decisions.jsonl` for review, and
`outputs/product-canonicalization-metrics.json` for coverage tracking. The
decision file contains every rewritten or unresolved distinct term, occurrence
counts, recipe counts, authored examples, and source examples. The stage does
not call an LLM, so DVC reproduction stays deterministic.

The ICN adapter parses WPRM markup instead of stripping HTML. It retains named
yield and measurement sections and removes exact duplicate responsive tables.
The tastyR adapter splits its comma stream only when the next item starts with a
stated quantity. It also keeps the original ingredient string in
`metadata.sourceMetadata.ingredientsText`.

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
                            -> prepare -> extracted recipes
                                       + compatible complete recipes + rejects
                                       + ingredient-only rows
                                       + Gutenberg boundary candidates
                            -> stats -> canonical recipes + metrics + plot
                            -> adapt-product -> product recipes + skips + metrics
                                              -> canonicalize-product
                                                 -> canonical product recipes
                                                 + review decisions + metrics
```

Each extracted row includes source dataset, record ID, URL, declared license,
retrieval date, source checksum, and content signature. This supports idempotent
loading and both exact-content and title-level deduplication.
The acquisition date lives in tracked `snapshot.json`; update it when refreshing
the raw corpus so reproducing an existing snapshot remains deterministic.

Run the complete pipeline from this directory:

```bash
mise x -- dvc repro
```

Or use the project tasks while developing an individual stage:

```bash
mise //ml-pipelines/recipe-dataset:download
mise //ml-pipelines/recipe-dataset:prepare
mise //ml-pipelines/recipe-dataset:stats
mise //ml-pipelines/recipe-dataset:adapt-product
mise //ml-pipelines/recipe-dataset:canonicalize-product
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
