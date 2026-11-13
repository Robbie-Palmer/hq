# Colorectal multistain epithelium source data

This DVC source product owns the publisher-native contract for *The
Colorectal_Cancer_IHC_CISH_HE_Epithelium_Segmentation dataset*, DOI
[`10.18710/DIGQGQ`](https://doi.org/10.18710/DIGQGQ). It pins DataverseNO V1,
all 20 deposited files, their persistent IDs, byte counts, MD5 checksums, and
the related Zenodo record `14800740`.

The product keeps the source's TMA core, tissue, stain, marker, probe, control,
image, and mask language. It does not define Pathologize cohorts, partitions,
ontology mappings, or genomic-status groups. Downstream products consume the
stable record and artifact references. They must not copy the source images.
The publisher describes pathologist manual annotation in a NoCodeSeg active
learning workflow, followed by final QuPath integration, and says pathologists
validated all annotations.

## Source contract

The publisher describes 100 anonymized patient groups, each with three normal
mucosa cores and three cancer cores. The deposited ZIP directories use patient
IDs `A001` through `A100`, tissue values `Normal mucosa` and `Cancer`, and core
numbers 1 through 3 and 4 through 6 respectively. Missing or excluded source
cores remain missing. The remote directory index contains 567 of the nominal
600 patient-tissue-core groups.

Every native record is one JPG TMA core image and its same-stem PNG epithelium
mask. Metadata-only indexing verifies all 13,179 pairs and publishes stable
references with:

- the source artifact ID and file DOI;
- the publisher path stem, image member, and mask member;
- patient and specimen group IDs;
- source tissue, core number, acquisition label, assay, and marker;
- the publisher's semantic-segmentation role and null partition.

The title uses `CISH`; the publisher's README and description call these
archives `ISH`. The contract retains `ISH` as the native assay value instead of
silently normalizing the term.

| Native assay | Marker or control | Image-mask pairs |
| --- | --- | ---: |
| H&E | Hematoxylin and eosin | 552 |
| Immunohistochemistry | E-Cadherin, Vimentin, SMA, Ki-67, SMAD3, MACC1, LASP1, CD44, NAIP, KLF5, FSCN1, CTNND1, KRAS | 7,132 |
| ISH | miR-143, miR-145, U6 snRNA positive control, scrambled-probe negative control | 5,495 |

The separate `SPSS_databases.zip` artifact contains the publisher's
project-specific measurements for two miRNAs and eight proteins. It is not a
Pathologize label table or cohort definition.

## Rights

DataverseNO V1 and its deposited `00_Readme.txt` state CC0 1.0. The Zenodo
record's description also says CC0, but Zenodo's platform license field says
CC BY 4.0. `manifest.json` preserves that discrepancy and treats DataverseNO
V1 as the canonical dataset record. Review the conflict before redistributing
source bytes.

## Metadata-only reproduction

The 18 image-mask archives total about 471 GB with the documentation and SPSS
files. The normal reproduction path does not download archive payloads:

```bash
mise //data-products/colorectal/multistain-epithelium:repro
mise //data-products/colorectal/multistain-epithelium:check
```

The first stage checks Dataverse and Zenodo metadata against the committed
version, rights, file IDs, sizes, and checksums. The second uses HTTP byte-range
requests to read ZIP directories and verify pair and specimen-group semantics.
DVC records the generated `outputs/native-index.jsonl`, metadata verification,
and source metrics without putting those generated files in Git.

## Original artifact retrieval

Retrieval is explicit and limited to one pinned artifact per invocation. The
command streams the selected file to `data/raw`, then checks its byte count and
publisher-provided MD5 before installing it. Both partial and verified source
bytes remain ignored by Git.

```bash
# Small documentation artifact
mise //data-products/colorectal/multistain-epithelium:acquire -- readme

# Large source archive, only when its storage cost is intentional
mise //data-products/colorectal/multistain-epithelium:acquire -- he
```

Available artifact IDs live in `manifest.json`. A downstream data product
should pin this project's `dvc.lock`, `manifest.json`, and native index. It
should retain `record_id`, `patient_group_id`, `specimen_group_id`, and source
artifact references when it adds any Pathologize-specific interpretation.
