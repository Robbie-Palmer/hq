import pytest
from pydantic import ValidationError

from ml_evaluation.contracts import ExecutionBudget, ExecutionUsage
from ml_evaluation.resources import (
    ResourceLimitError,
    enforce_resource_limits,
    resource_limit_violations,
)


def _budget() -> ExecutionBudget:
    return ExecutionBudget(
        max_wall_seconds=20,
        max_accelerator_seconds=10,
        max_peak_accelerator_bytes=100,
        minimum_free_disk_bytes=50,
    )


def test_accepts_usage_within_execution_budget() -> None:
    usage = ExecutionUsage(
        wall_seconds=19,
        accelerator_seconds=9,
        peak_accelerator_bytes=99,
        free_disk_bytes=51,
    )
    assert resource_limit_violations(_budget(), usage) == ()
    assert enforce_resource_limits(_budget(), usage) is None


def test_reports_every_exceeded_or_unverified_limit() -> None:
    budget = _budget()
    usage = ExecutionUsage(
        wall_seconds=21,
        accelerator_seconds=None,
        peak_accelerator_bytes=101,
        free_disk_bytes=49,
    )
    violations = resource_limit_violations(budget, usage)

    assert [violation.resource for violation in violations] == [
        "wall_seconds",
        "accelerator_seconds",
        "peak_accelerator_bytes",
        "free_disk_bytes",
    ]
    assert violations[1].observed is None
    assert violations[-1].relation == "minimum"
    with pytest.raises(ResourceLimitError, match="accelerator_seconds") as error:
        enforce_resource_limits(budget, usage)
    assert error.value.violations == violations


def test_execution_budget_requires_a_limit() -> None:
    with pytest.raises(ValidationError, match="at least one limit"):
        ExecutionBudget()
