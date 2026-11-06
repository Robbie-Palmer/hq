# Pathologize data registry

This project tracks public computational-pathology source datasets used by
Pathologize. It records where each dataset came from, its licence and access
terms, checksums, source identities, scanner metadata, physical resolution,
and labels published with the source.

Keep raw slides canonical here. Tiles, embeddings, masks, model output,
task-specific labels, and train or test splits belong in the downstream
project that creates them.

## Registered data

| Collection | Registry status | Licence |
| --- | --- | --- |
| CPTAC-COAD Slide Microscopy | One complete six-file DICOM series, 18,701,962 bytes | CC BY 3.0 |
| CAMELYON16 | Manifest only | CC0 1.0 |
| PANDA | Manifest only | CC BY-NC-SA 4.0 and Kaggle access terms |

The CPTAC-COAD series is a small pipeline fixture from NCI Imaging Data
Commons. It is not a representative scientific cohort. CAMELYON16 and PANDA
remain manifest-only because their size or access terms do not suit an
unattended starter download.

## Repository layout

```text
registry.json                 registry indexes
manifests/collections/        source, access, licence, citation, and scale
manifests/subsets/            bounded source selections with no task split
manifests/assets/             source URLs, byte counts, and SHA-256 digests
records/slides/               patient, case, specimen, slide, and scanner data
schemas/                      generated JSON Schemas
data/raw/                     DVC-managed source files, ignored by Git
```

The acquisition command accepts only allowlisted HTTPS sources. It checks the
declared byte count and SHA-256 digest before installing a file. Validation
reads DICOM headers without decoding pixel data.

## Get started

Run tasks through mise from the repository root or any subdirectory.

```bash
# Download the 18.7 MB starter subset and verify its checksums.
mise //ml-pipelines/pathologize-data-registry:acquire

# Run lint, type checks, tests, schema drift checks, and data validation.
mise //ml-pipelines/pathologize-data-registry:check
```

`check` acquires the starter subset when it is absent. To inspect a checkout
without downloading data, run:

```bash
mise //ml-pipelines/pathologize-data-registry:validate
```

Use `mise //ml-pipelines/pathologize-data-registry:repro` to reproduce the
acquisition through DVC. `verify` requires all files in the acquired subset;
`validate` checks manifests and any source files already present.

## Add a collection

1. Add a collection manifest with the publisher's source, access route,
   licence scope, redistribution conditions, and citation.
2. Preserve source patient, case, specimen, slide, and label identities. Mark
   missing metadata as missing instead of inferring it from filenames or
   tissue appearance.
3. Keep large, gated, authenticated, or legally unclear collections
   manifest-only.
4. Add a subset and asset manifest only when automated access is permitted.
   Bound the download, pin every source URL, and record each byte count and
   SHA-256 digest.
5. Regenerate the schemas and run the project check.

```bash
mise //ml-pipelines/pathologize-data-registry:schemas
mise //ml-pipelines/pathologize-data-registry:check
```

Public availability does not grant redistribution rights. The collection
manifest must state what the source licence and access terms allow.

## Use the registry downstream

A downstream project pins the registry Git revision, subset ID, and slide IDs
that it consumes. It treats `data/raw` as read-only input and keeps its derived
outputs in its own DVC project.

Do not copy collection manifests or redefine patient, specimen, or slide IDs.
Downstream benchmark and training projects own leakage groups, data splits,
tiles, features, and task-specific label interpretations.
