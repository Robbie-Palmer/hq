# Pathologize slide-quality benchmark

This project evaluates whole-slide tissue and artifact quality contracts. Its
manifest covers tissue IoU, artifact macro F1, artifact-free tissue Dice,
slide rejection accuracy, and slide-rejection Brier score. The clean test case
checks false rejection instead of testing only defective slides. The DVC graph
writes execution records, evaluation results, a comparison scorecard, a
benchmark index, and a DVC metrics file as separate outputs.

```bash
mise run //ml-pipelines/pathologize-slide-quality-benchmark:check
mise run //ml-pipelines/pathologize-slide-quality-benchmark:dvc -- dag
```

The fixture generator writes plain-text PPM RGB images and PGM masks. They are
deterministic geometric test data, not pathology data. The color baseline is
expected to score nearly perfectly because colors encode the fixture answer.
Those values prove metric and pipeline wiring only.

The project stores no clinical image, annotation, or invented registry record.
It makes no clinical-validity claim.

## Bounded public-data pilot

The real-data pilot predeclares a fixed 24-slide AIRAQc TCGA test cohort, a
16.5 GB network cap, a 40 GB local-disk cap, two wall hours, eight CPU hours,
and no GPU use. It decodes the four released annotation colours without a
tissue gate. That produces 14 defect-positive and 10 clean-negative slides.
The later reproducibility deposit's 13/11 count depends on tissue eligibility,
so it is not used as the slide truth here.

Twenty-three slides expose native Aperio `ScanScope ID` values. The remaining
Leica SCN400 slide identifies its model but has no stable device identifier. A
dated protocol amendment retains that slide in the primary evaluation and
omits it only from scanner-held-out slices. The record preserves the original
stop rule and the reason for changing it before feature extraction.

The deterministic candidate evaluated all 24 slides and stopped on substantive
performance gates. Accuracy was 0.500 and balanced accuracy was 0.457. It did
not beat constant accept (accuracy 0.417, one-sided exact McNemar p=0.407) or
constant reject (accuracy 0.583, p=1.000). The eligible SS1763CNTLR slice fell
to 0.250 accuracy versus 0.500 overall and a 0.750 within-slice constant. No
learned candidate was run: 24 slides cannot support leakage-safe grouped
fitting, calibration, and scanner-held-out evaluation.

The run verified 15,813,730,059 source bytes, read 528,941,634 pixels, and wrote
2,251 numeric spatial records in 96.86 wall seconds and 96.64 CPU seconds. It
used no GPU time or VRAM, peaked at 2,618,855,424 bytes of RSS, and
conservatively bounded peak local disk at 33,708,181,738 bytes. The kernel
reported 16,172,980,880 process characters and zero physical read bytes.
`public-pilot/results/report.json` contains the exact run record, exclusions,
identity audit, rights boundary, resource record, and hashes for every
provenance manifest.

Source SVS files, annotation image files, and rendered patient imagery stay outside
Git. The repository contains only source identifiers and checksums, numeric
per-slide label evidence, empty spatial output documenting the preflight stop,
and aggregate results. The annotation folder has no standalone licence file,
so this conservative boundary applies even though the linked paper is CC BY
4.0 and GDC marks the slides open access.

Reproduce the registry acquisition and stopped pilot with:

```bash
mise //ml-pipelines/pathologize-data-registry:repro:airaqc-pilot
mise //ml-pipelines/pathologize-slide-quality-benchmark:pilot:repro
mise //ml-pipelines/pathologize-slide-quality-benchmark:pilot:verify
```

The source review and reconstruction details are in
[`public-pilot/README.md`](public-pilot/README.md).
