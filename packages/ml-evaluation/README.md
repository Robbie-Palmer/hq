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

`packages/data-artifacts` owns canonical JSON and JSON Lines, hashing,
root-confined paths, source fingerprints, and schema artifact writing.
Evaluation projects compose the two packages without making file mechanics
part of the ML contract.

Evaluation projects own their data contracts, leakage units, prediction types,
metrics, safety policy, and scorecard envelope. Importing this package does not
make two projects share those domain decisions.

For a Python entrypoint, `artifact_sha256` hashes the module file that defines
the entrypoint attribute. The loader resolves and hashes that file before it
imports the module or invokes the attribute.

Run the package checks through mise:

```bash
mise run //packages/ml-evaluation:check
```
