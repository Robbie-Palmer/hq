# ML evaluation

`ml-evaluation` contains Python contracts and deterministic utilities shared by
evaluation projects. It has no dataset, clinical domain, model provider, or
task-specific metric vocabulary.

The package owns:

- strict Pydantic base types for adapters, objectives, resource budgets, runs,
  and gates;
- canonical JSON, JSON Lines, hashing, and root-confined artifact paths;
- pinned Python entrypoint loading with adapter identity checks;
- metric and resource promotion gates; and
- deterministic JSON Schema artifact writing, drift checks, and source
  fingerprints for DVC dependencies.

Evaluation projects own their data contracts, leakage units, prediction types,
metrics, safety policy, and scorecard envelope. Importing this package does not
make two projects share those domain decisions.

Run the package checks through mise:

```bash
mise run //packages/ml-evaluation:check
```
