# Pathologize slide-quality benchmark

This project evaluates whole-slide tissue and artifact quality contracts. Its
manifest covers tissue IoU, artifact macro F1, artifact-free tissue Dice, and
slide rejection accuracy. The DVC graph produces its own validation report,
run resources, scorecard, and DVC metrics file.

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
