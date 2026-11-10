# ML evaluation

`ml-evaluation` contains Python contracts and decision rules shared by
evaluation projects. It has no dataset, clinical domain, model provider, or
task-specific metric vocabulary.

The package owns:

- strict Pydantic base types for adapters, objectives, resource budgets, run
  records, artifact references, failure reports, and gates;
- pinned Python entrypoint loading with module digests, adapter identity, and
  version checks;
- metric and resource promotion gates.
- checkpoint-series provenance bound to parameter and source-run digests;
- execution budget enforcement for wall time, accelerator time, accelerator memory,
  and free disk;
- hierarchical clustered bootstrap intervals and paired learning-error-curve
  comparison.

`packages/data-artifacts` owns canonical JSON and JSON Lines, hashing,
root-confined paths, source fingerprints, and schema artifact writing.
Evaluation projects compose the two packages without making file mechanics
part of the ML contract.

Evaluation projects own their data contracts, leakage units, prediction types,
metrics, safety policy, and scorecard envelope. Importing this package does not
make two projects share those domain decisions.

Curve analysis accepts additive per-cluster sufficient statistics and a caller-owned
statistic function. A pathology project can resample patients, while another project
can use slides, documents, or accounts without importing domain vocabulary here. The
learning-error-curve comparison reports the first minimum, later peak, later minimum,
bootstrap support, and replicate agreement. It does not assume that interpolation is
required to observe the curve pattern.

For a Python entrypoint, `artifact_sha256` hashes the module file that defines
the entrypoint attribute. The loader resolves and hashes that file before it
imports the module or invokes the attribute.

Run the package checks through mise:

```bash
mise run //packages/ml-evaluation:check
```
