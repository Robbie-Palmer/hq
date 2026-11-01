# Financial-document IDP evaluation

This DVC project measures financial-document extraction before a parser can be
considered for production. The committed corpus specification contains invented
names, accounts, dates, and amounts. The pipeline generates its PDFs, HTML
files, and grayscale images from that specification, so no private finance
document belongs in this repository or its DVC cache.

The first contract covers bank statements, credit-card statements, and
payslips. The canonical schema records document metadata, accounts, periods,
balances, transactions, and ISO currency codes. JSON Schemas under `schemas/`
make both the extraction contract and corpus provenance reviewable without
running Python.

## Pipeline

`dvc.yaml` is the source of truth for the stage names and dependencies. Inspect
the graph with:

```bash
mise run //ml-pipelines/financial-document-idp-evaluation:dvc -- dag
```

The generated fixtures test the evaluation contract and stage boundaries
without an OCR runtime. They are not production document parsers.

## Reproduce it

Run every command through mise:

```bash
mise run //ml-pipelines/financial-document-idp-evaluation:sync
mise run //ml-pipelines/financial-document-idp-evaluation:repro
mise run //ml-pipelines/financial-document-idp-evaluation:verify
mise run //ml-pipelines/financial-document-idp-evaluation:check
```

`uv.lock` pins Python and test dependencies. `dvc.lock` pins every input and
output hash. The final provenance artifact records content hashes for the code,
parameters, prompt, model manifest, corpus manifest, stage artifacts, and
failure files. The pipeline makes no network call and does not require a model
API key.

## Metrics and gates

`outputs/evaluation/metrics.json` reports canonical-field accuracy, transaction
precision and recall, balance reconciliation, expected abstention recall,
adversarial defense, cost, and latency. It repeats those measurements by
provider, document format, scan quality, and language.

`params.yaml` fixes the production-entry gates. The candidate must pass every
quality gate, abstain on the prompt-injection and incomplete-scan documents, and
stay under both cost and latency limits. `release-decision.json` is advisory. It
does not deploy or change a production parser.

## Corpus rules

New entries must be synthetic, consented, or strongly redacted. The manifest
must state which one applies and must carry the document checksum and source
rights. Never copy a personal bank statement, card statement, payslip, invoice,
or tax document into `fixtures/`, `data/`, a test, a Pull Request, or the DVC
remote.
