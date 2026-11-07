# AIRAQc TCGA public pilot

## Decision

One of 24 slides, TCGA-3C-AALI, has a native header that identifies a Leica
SCN400 but does not contain an `aperio.ScanScope ID`. The first run stopped at
that predeclared rule. A dated protocol amendment made before feature
extraction retains the slide in the primary evaluation and excludes it only
from scanner-held-out slices. No scanner identity was inferred and no slide was
dropped from the main cohort.

The pilot then ran a fixed, deterministic slide classifier on all 24 slides.
It is an inference algorithm, but it has no fitted parameters. The next section
states its complete decision rule. Its 0.500 accuracy and 0.457 balanced
accuracy failed to reject constant accept (p=0.407) or constant reject
(p=1.000). The eligible SS1763CNTLR scanner slice also collapsed to 0.250
accuracy. These performance gates stop the experiment. A 24-slide cohort
cannot justify a learned candidate.

This is a valid negative pilot result and supports no claim about clinical
utility.

## Deterministic decision rule

The classifier reads each slide at 2.5x in 512-pixel tiles. It retains tiles
with at least 20% tissue and computes tissue fraction, mean edge gradient,
blue or teal pixel fraction, and dark pixel fraction. It rejects a slide if
any of these rules fires:

- At least 10% of tissue tiles have mean gradient no greater than 0.018 and no
  greater than 45% of that slide's median tissue-tile gradient.
- Any tissue tile contains at least 0.2% blue or teal pixels.
- Any tissue tile contains at least 12% dark pixels.

The implementation is in
[`pilot.py`](../src/pathologize_slide_quality_pilot/pilot.py). The thresholds
were frozen before the run in [`predeclaration.json`](predeclaration.json).
The classifier's Boolean decision supplies `prediction_reject`; the AIRAQc
palette labels supply `truth_reject`. The confusion matrix and the exact
one-sided McNemar comparisons against constant accept and constant reject come
from those two fields.

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
| Peak local disk | 40,000,000,000 bytes | 33,707,124,493-byte conservative upper bound |
| Feature-runner wall time | 7,200 seconds | 96.86 seconds |
| Feature-runner CPU time | 28,800 seconds | 96.64 seconds |
| GPU time | 0 seconds | 0 seconds |
| Peak VRAM | 0 bytes | 0 bytes |
| Peak RSS | No separate cap | 2,618,855,424 bytes |
| Source bytes verified in preflight | 15,813,730,059 bytes | 15,813,730,059 bytes |

The DVC cache and materialized pilot source occupy about 31.63 GB logically.
The 33,708,181,738-byte disk upper bound adds one largest-file temporary copy
and result bytes. The kernel reported zero physical read bytes during the final
run; the process character count was 16,172,980,880.

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
- `corpus.json` pins all 24 stable patient-group keys, slide, scanner, source,
  annotation, and label records plus registry-manifest hashes. Patient-group
  keys are full, domain-separated SHA-256 digests of the public TCGA submitter
  IDs; `source-index.json` retains the reconstruction mapping.
- `results/per-slide.jsonl` contains numeric labels, predictions, scanner
  evidence, and deterministic feature summaries for every slide.
- `results/spatial-evidence.jsonl` contains 2,251 numeric tile records;
  `results/features.jsonl` contains one aggregate feature record per slide.
- `results/report.json` and `results/resources.json` contain the settled
  decision and resource evidence.

Raw source bytes live only under the data registry's ignored DVC output. No
SVS, annotation PNG, or rendered tissue image is committed.
