# Data artifacts

`data-artifacts` provides deterministic file helpers shared by Python projects.
It has no ML, dataset, provider, or application-domain vocabulary.

The package owns:

- canonical and readable JSON serialization;
- JSON and JSON Lines file reads and writes;
- Pydantic model loading from JSON;
- SHA-256 hashes for bytes, files, and directory trees;
- content-address identifiers;
- Python source fingerprints; and
- root-confined path resolution; and
- deterministic Pydantic JSON Schema writing and drift checks.

Domain packages decide what their files mean. They also own validation beyond
basic JSON parsing and Pydantic model construction.

Run its checks through mise:

```bash
mise run //packages/data-artifacts:check
```
