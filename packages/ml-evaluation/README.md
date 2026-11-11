# ML evaluation

`ml-evaluation` provides shared contracts and analysis helpers for machine-learning
evaluation projects in this repository. It is deliberately independent of datasets,
model providers, and task-specific metrics.

Use it to:

- define adapters, metric objectives, run records, artifact references, and promotion
  gates with strict Pydantic models;
- load pinned Python entrypoints and verify their module digests, adapter identities,
  and versions;
- bind a checkpoint series to parameter and source-run digests, then verify every
  checkpoint before evaluation;
- declare execution limits and reject missing or over-budget resource measurements;
- calculate cluster-aware bootstrap intervals and compare replicated learning curves.

Evaluation projects still define their own data contract, cluster unit, prediction
format, metrics, and release policy. `packages/data-artifacts` provides canonical JSON
and JSON Lines handling, hashing, root-confined paths, source fingerprints, and schema
artifact writing.

## Checkpoint provenance

`index_checkpoints` records project-relative paths and SHA-256 digests in step order.
It rejects missing files and paths outside the supplied root. Call
`verify_checkpoint_series` before consuming the files to detect missing or changed
checkpoints.

```python
from pathlib import Path

from ml_evaluation.provenance import index_checkpoints, verify_checkpoint_series

root = Path("artifacts/run-42")
series = index_checkpoints(
    root,
    {1: "checkpoints/step-1.pt", 2: "checkpoints/step-2.pt"},
    parameters_sha256="a" * 64,
    source_run_sha256="b" * 64,
)
paths = verify_checkpoint_series(root, series)
```

## Execution limits

`enforce_resource_limits` compares observed usage with declared maximums and minimums.
An enabled limit also requires a corresponding measurement. The function raises
`ResourceLimitError` with one structured violation per failed or unverified limit.

```python
from ml_evaluation.contracts import ExecutionBudget, ExecutionUsage
from ml_evaluation.resources import enforce_resource_limits

budget = ExecutionBudget(
    max_wall_seconds=3_600,
    max_accelerator_seconds=3_600,
    max_peak_accelerator_bytes=16 * 1024**3,
)
usage = ExecutionUsage(
    wall_seconds=2_200,
    accelerator_seconds=2_050,
    peak_accelerator_bytes=11 * 1024**3,
)
enforce_resource_limits(budget, usage)
```

## Cluster-aware curve analysis

Curve helpers accept one curve per replicate. Each step maps stable cluster identifiers
to additive numeric totals. The caller supplies a function that converts the summed
totals into the statistic being analysed. This keeps resampling at the independent
sampling unit instead of treating individual observations as independent.

```python
from collections.abc import Sequence

from ml_evaluation.contracts import BootstrapConfig
from ml_evaluation.curve_analysis import compare_error_curve


def error_rate(totals: Sequence[float]) -> float:
    errors, observations = totals
    return errors / observations


comparison = compare_error_curve(
    curves,
    error_rate,
    baseline_horizon_steps=40,
    smoothing_window_steps=3,
    minimum_change=0.01,
    bootstrap=BootstrapConfig(replicates=2_000, seed=17, confidence_level=0.95),
)
```

`compare_error_curve` finds the lowest smoothed window within the baseline horizon,
the highest later window, and the lowest window after that peak. It reports paired
cluster-bootstrap intervals, per-replicate direction checks, and whether the declared
minimum change and agreement rules support the pattern. The function does not choose
the horizon, smoothing width, threshold, or cluster unit for the caller.

## Development

Run formatting, linting, type checks, tests, and coverage through mise:

```bash
mise //packages/ml-evaluation:check
```
