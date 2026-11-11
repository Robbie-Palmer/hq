# NCI BPV source metadata product

This source product pins the NCI Biospecimen Pre-analytical Variables study at
dbGaP `phs001304.v1.p1` and BioProject `PRJNA932917`. The seven released dbGaP
substudies remain parts of the publisher-defined BPV cohort. They are not
separate Pathologize cohorts.

The checked-in fixture contains public dbGaP XML only: the study exchange,
seven data dictionaries, and seven aggregate variable reports. The build
preserves the native study and table accessions, publisher experiment counts,
variable names, descriptions, units, aggregate values, and null counts. It
also records the 153 consented subjects and the publisher's diagnoses.

The study contract keeps the native preparation conditions and assay scope.
These include matched FFPE and freshly frozen material, delay to fixation,
time in formalin, dry ice and liquid nitrogen freezing, minus 80 C and liquid
nitrogen storage, storage duration, OCT and non-OCT embedding, pathology
review, RNA-seq, miRNA-seq, WES, aCGH, proteomics, phosphoproteomics,
metabolomics, TaqMan, and PCR.

## Deterministic metadata build

The default build is metadata-only. It uses no dbGaP credentials and makes no
network request.

```bash
mise //data-products/nci/bpv-v1:repro
mise //data-products/nci/bpv-v1:check
```

DVC writes the public variable definitions, aggregate statistics,
missingness, study and substudy records, source inventory, rights, and native
identity contract under `outputs/`. The fixture checksums and sizes must match
`contracts/source-inventory.json` before parsing starts.

## Safe public metadata checks

The live check sends unauthenticated GET requests only to exact allowlisted
NCBI HTTPS paths. It verifies the pinned XML sizes and SHA-256 checksums, then
checks that the dbGaP study and BioProject pages still expose the pinned
identifiers.

```bash
mise //data-products/nci/bpv-v1:live:check
```

`acquire` uses the same allowlist and checksum checks before replacing the
public fixture. It does not read environment credentials or call an authorized
dbGaP endpoint.

```bash
mise //data-products/nci/bpv-v1:acquire
```

## Authorized records

Participant, specimen, block, aliquot, assay, and molecular artifact records
require dbGaP Authorized Access and an approved Data Use Certification. The
identity contract retains those source IDs and their publisher links without
renaming them. It also retains source missingness, access tiers, file sizes,
and checksums when an authorized manifest exposes them.

Validate an authorized JSONL export in place with:

```bash
mise //data-products/nci/bpv-v1:authorized:validate -- --records /secure/path/bpv.jsonl
```

The command prints aggregate counts only. It does not copy the export into the
repository. Keep authorized records, credentials, molecular files, and image
bytes outside this checkout.

## Product boundary

The reusable source data are molecular assay and biospecimen records. BPV is
not a public whole-slide image corpus. This product adds no Pathologize
thresholds, preparation labels, exclusions, outcome harmonization, comparison
logic, SOP recommendations, or machine-learning partitions. A downstream
product may use the native records for assay-suitability, artifact, storage,
or SOP comparisons after it defines and reviews its own logic.

Public access is not a general redistribution license. Consult
`contracts/access-and-rights.json` and the linked dbGaP Data Use Certification
before using controlled data.
