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
| AIRAQc TCGA artifact test set | Fixed 24-slide pilot subset, 15,813,730,059 bytes including annotations | CC BY 4.0 paper; linked annotation folder has no standalone licence file |
| CPTAC-COAD Slide Microscopy | One complete six-file DICOM series, 18,701,962 bytes | CC BY 3.0 |
| CAMELYON16 | Manifest only | CC0 1.0 |
| PANDA | Manifest only | CC BY-NC-SA 4.0 and Kaggle access terms |

The AIRAQc subset uses the fixed 24-slide test partition from the cited
reproducibility deposit. It keeps GDC file, case, and TCGA slide identities,
plus stable domain-separated SHA-256 patient-group keys and native Aperio
scanner serials where present. The pinned source index retains the public TCGA
submitter-ID mapping. One Leica SCN400 slide has no native device identifier;
the downstream pilot records that limitation, retains the slide in its primary
evaluation, and excludes it only from scanner-held-out slices. Source SVS and
annotation bytes must not be redistributed.

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
reads DICOM or Aperio headers without decoding pixel data.

## Get started

Run tasks through mise from the repository root or any subdirectory.

```bash
# Download the 18.7 MB starter subset and verify its checksums.
mise //ml-pipelines/pathologize-data-registry:acquire

# Acquire the bounded 24-slide AIRAQc pilot subset under its 16.5 GB cap.
mise //ml-pipelines/pathologize-data-registry:acquire:airaqc-pilot

# Reproduce the already acquired AIRAQc subset through DVC.
mise //ml-pipelines/pathologize-data-registry:repro:airaqc-pilot

# Require all 48 pilot source and annotation assets and verify their hashes.
mise //ml-pipelines/pathologize-data-registry:verify:airaqc-pilot

# Run lint, type checks, tests, schema drift checks, and data validation.
mise //ml-pipelines/pathologize-data-registry:check
```

`check` acquires the starter subset when it is absent. To inspect a checkout
without downloading data, run:

```bash
mise //ml-pipelines/pathologize-data-registry:validate
```

The check also generates the portable metadata export in memory and validates
it with `mlcroissant`. Write the Croissant 1.1 document for the current Git
revision with:

```bash
mise //ml-pipelines/pathologize-data-registry:export
```

The command writes `outputs/pathologize-public-data.croissant.json`. Publish
that generated file from the same revision that downstream consumers pin. Do
not edit it by hand.

Use `mise //ml-pipelines/pathologize-data-registry:repro` to reproduce the
starter acquisition through DVC. `verify` requires the starter files and
`verify:airaqc-pilot` requires all pilot files. `validate` checks manifests and
any source files already present.

## Add a collection

1. Add a collection manifest with the publisher's source, access route,
   licence scope, redistribution conditions, and citation.
2. Preserve source patient, case, specimen, slide, and label identities. Use
   `null` for optional metadata that the source omits. If a required identity
   is absent, keep the collection manifest-only until the schema supports an
   honest representation; never infer it from filenames or tissue appearance.
3. Keep large, gated, authenticated, or legally unclear collections
   manifest-only.
4. Add a subset and asset manifest only when automated access is permitted.
   Bound the download, pin every source URL, and record each byte count and
   SHA-256 digest.
5. Declare the acquired subset's `data/raw` asset root as a DVC stage output.
6. Regenerate the schemas and run the project check.

```bash
mise //ml-pipelines/pathologize-data-registry:schemas
mise //ml-pipelines/pathologize-data-registry:check
```

Public availability does not grant redistribution rights. The collection
manifest must state what the source licence and access terms allow.

## Use the registry downstream

A downstream project pins the registry URI, Git revision, Croissant export
path, and export SHA-256. It selects subset and slide IDs in its own manifest,
treats `data/raw` as read-only input, and keeps derived outputs in its own DVC
project.

Do not copy collection manifests or redefine patient, specimen, or slide IDs.
Downstream benchmark and training projects own data splits and the checks that
keep related patient, specimen, block, slide, acquisition, or site records in
one split. They also own tiles, features, and task-specific label
interpretations. A source export does not invent missing block, site, or
acquisition identities. A downstream ontology mapping must record its target
version, mapping status, provenance, and unmapped source categories.
