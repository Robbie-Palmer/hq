# AIRAQc TCGA public pilot

## Decision

The fixed-cohort experiment stopped at scanner-identity preflight. One of 24
slides, TCGA-3C-AALI, has a native header that identifies a Leica SCN400 but
does not contain an `aperio.ScanScope ID`. The predeclared rule forbids
substituting a scanner family for a stable device identity or dropping the
slide after acquisition. No deterministic candidate or learned model was run.

This is a valid negative pilot result and supports no claim about clinical utility.

## Source selection

The selection was locked before source-slide download.

- The [AIRAQc MIDL 2025 paper](https://openreview.net/pdf?id=XNNsQqs1UP)
  reports 50 manually annotated TCGA slides, including artifact-free slides
  and four artifact classes, and links the annotation folder used here.
- [NCI GDC](https://docs.gdc.cancer.gov/API/Users_Guide/Getting_Started/)
  supplies stable file UUIDs, case UUIDs, TCGA patient and slide identifiers,
  byte counts, MD5 values, and open-access source SVS files.
- The fixed 24-slide partition comes from the
  [v1.0.1 reproducibility deposit](https://zenodo.org/records/22932961). Its
  archive and split-file SHA-256 values are pinned in `source-index.json`.
- [GrandQC masks](https://zenodo.org/records/14041578) were rejected as ground
  truth because they are model-produced and carry a non-commercial boundary.
- [HistoArtifacts](https://zenodo.org/records/10809442) was rejected because
  the deposit declares no licence and does not preserve the required patient
  and scanner identities.
- The [Augsburg scanner comparison](https://doi.org/10.1111/his.70136) has
  useful multi-scanner ratings, but no bounded stable download route was
  documented well enough for this pilot.

## Locked resources and result

| Item | Predeclared cap | Observed |
| --- | ---: | ---: |
| Network acquisition | 16,500,000,000 bytes | 15,813,730,059 bytes |
| Peak local disk | 40,000,000,000 bytes | 33,707,121,037-byte conservative upper bound |
| Feature-runner wall time | 7,200 seconds | 8.30 seconds |
| Feature-runner CPU time | 28,800 seconds | 8.29 seconds |
| GPU time | 0 seconds | 0 seconds |
| Peak VRAM | 0 bytes | 0 bytes |
| Peak RSS | No separate cap | 58,351,616 bytes |
| Source bytes verified in preflight | 15,813,730,059 bytes | 15,813,730,059 bytes |

The DVC cache and materialized pilot source occupy about 31.63 GB logically.
The disk upper bound adds one largest-file temporary copy and result bytes.
The kernel reported zero physical read bytes during the final run because the
files were cached; the process character count was 15,813,772,920.

The palette audit finds 14 positive and 10 clean-negative slides. It does not
use a tissue gate for truth, so tissue amount cannot change a slide label.
Clean means that no pixel matches the four released palette classes within the
declared RGB distance. It does not prove the absence of an unannotated defect.

## Artifacts

- `predeclaration.json` contains the frozen cohort, thresholds, resource caps,
  rights boundary, and stop rules.
- `source-index.json` pins source IDs, byte counts, publisher MD5 values,
  annotation SHA-256 values, exclusions, failed acquisitions, and source
  review.
- `corpus.json` pins all 24 patient, slide, scanner, source, annotation, and
  label records plus registry-manifest hashes.
- `results/per-slide.jsonl` contains numeric label and scanner evidence for
  every slide. Predictions are explicitly marked not run.
- `results/spatial-evidence.jsonl` and `results/features.jsonl` are empty
  because the stop gate fired before feature extraction.
- `results/report.json` and `results/resources.json` contain the settled
  decision and resource evidence.

Raw source bytes live only under the data registry's ignored DVC output. No
SVS, annotation PNG, or rendered tissue image is committed.
