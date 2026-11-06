# Pathologize public data registry

This DVC project owns Pathologize's public computational-pathology source
data. It records provenance, access terms, licences, source checksums, source
identities, scanner details, physical resolution, and labels supplied by the
publisher. It does not own tiles, embeddings, task labels, model output, or
dataset splits.

The first acquisition is deliberately small. It contains one complete
CPTAC-COAD DICOM slide-microscopy series from NCI Imaging Data Commons:

- patient and source case `09CO003`;
- one specimen and slide container;
- six DICOM instances, including the native-resolution volume, resampled
  volumes, label, thumbnail, and overview;
- 18,701,962 bytes in total; and
- CC BY 3.0, with the attribution recorded in the collection manifest.

The acquisition selects the smallest CPTAC-COAD `SM` series in IDC index v23,
ordered by published series size and then Series Instance UID. This is a
pipeline fixture, not a representative scientific cohort. CAMELYON16 and
PANDA are registered without data. Their scale and access conditions make an
automatic starter download inappropriate.

## Registry boundary

Git owns all reviewable records:

```text
registry.json                 registry scope and manifest indexes
manifests/collections/        source, access, licence, citation, and scale
manifests/subsets/            source selection, with no task split
manifests/assets/             immutable source URL, byte count, and SHA-256
records/slides/               patient through slide identity and source metadata
schemas/                      generated JSON Schemas
```

DVC owns materialized source bytes under `data/raw`. The acquisition stage
fetches only allowlisted HTTPS URLs, refuses a subset above its byte limit,
writes through a temporary file, and checks the byte count and SHA-256 before
renaming it. Validation reads DICOM headers without decoding pixel data and
checks the manifest against source identities and metadata.

This project has no DVC remote. A clean checkout reproduces the bounded data
from the public IDC objects in `dvc.yaml`. No registry command uploads to R2.
Adding a remote or redistributing source bytes needs a separate licence and
cost review.

## Standards boundary

The platform accepts DVC for dataset and evaluation-artifact versioning and
OCI as the portable artifact envelope. Agent-first Writing also accepts
ModelPack v0.0.7 for model metadata and CNCF media types on top of OCI. That is
the repository's concrete model-packaging precedent. Pathologize should reuse
it instead of creating another model manifest when it registers model weights.
This dataset registry contains no model artifacts.

ModelPack defines media types for dataset files bundled as layers in a model
package. It does not define a standalone dataset metadata record. The registry
therefore uses generated JSON Schemas for its governance records and SPDX
licence identifiers for source terms. It does not claim CNCF compatibility for
those dataset records. Adopting a portable dataset metadata format, such as
MLCommons Croissant, needs a separate decision and migration contract.

The platform DVC decision normally requires an external DVC blob remote. This
starter registry is a stated exception because this change may not upload to
R2. Its DVC stage reconstructs the pinned output from public IDC objects. A
later remote decision must preserve the same digests and source terms.

## Commands

Run every command through mise from anywhere in the repository:

```bash
# Install the pinned Python environment.
mise //ml-pipelines/pathologize-data-registry:sync

# Fetch or reuse the six source objects, then validate their DICOM headers.
mise //ml-pipelines/pathologize-data-registry:acquire
mise //ml-pipelines/pathologize-data-registry:verify

# Reproduce the public acquisition as a DVC stage.
mise //ml-pipelines/pathologize-data-registry:repro

# Run lint, type checks, synthetic tests, schema drift checks, and data checks.
mise //ml-pipelines/pathologize-data-registry:check
```

`validate` permits an unmaterialized checkout and checks every available
source file. `verify` requires the full acquired subset. Neither command calls
the network.

## Downstream use

A downstream task project records three values: the registry Git revision,
the subset ID, and the slide IDs it consumes. It materializes that pinned
registry revision, then treats `data/raw` as read-only input. Its DVC stage may
depend on the registry source directory, but its outputs stay in the
downstream project.

Do not copy collection manifests or redefine patient, specimen, or slide IDs
downstream. Do not add benchmark folds here. Leakage groups, train and test
partitions, tiles, masks, features, and task-specific label interpretations
belong to the benchmark or training project that creates them.

When adding a collection:

1. Record the publisher's current source, access route, licence scope,
   redistribution conditions, and citation.
2. Keep large, gated, authenticated, non-automatable, or legally unclear data
   manifest-only.
3. Add an acquired subset only when unattended access is allowed and the
   byte limit is appropriate for local verification.
4. Preserve source identities and labels. State missing labels instead of
   inferring them from the collection name or tissue appearance.
5. Generate schemas, reproduce DVC, validate the data, and run the full check.

Public availability alone is not permission to republish a dataset. The
collection manifest is the review point for that distinction.
