from __future__ import annotations

from .contracts import ExecutionBudget, ExecutionUsage, ResourceLimitViolation


class ResourceLimitError(RuntimeError):
    def __init__(self, violations: tuple[ResourceLimitViolation, ...]) -> None:
        self.violations = violations
        names = ", ".join(violation.resource for violation in violations)
        super().__init__(f"execution resource limits exceeded or unverified: {names}")


def resource_limit_violations(
    budget: ExecutionBudget, usage: ExecutionUsage
) -> tuple[ResourceLimitViolation, ...]:
    violations: list[ResourceLimitViolation] = []
    maximums = (
        ("wall_seconds", budget.max_wall_seconds, usage.wall_seconds),
        ("accelerator_seconds", budget.max_accelerator_seconds, usage.accelerator_seconds),
        (
            "peak_accelerator_bytes",
            budget.max_peak_accelerator_bytes,
            usage.peak_accelerator_bytes,
        ),
    )
    for resource, limit, observed in maximums:
        if limit is not None and (observed is None or observed > limit):
            violations.append(
                ResourceLimitViolation(
                    resource=resource,
                    relation="maximum",
                    observed=observed,
                    limit=float(limit),
                )
            )
    minimum = budget.minimum_free_disk_bytes
    if minimum is not None and (usage.free_disk_bytes is None or usage.free_disk_bytes < minimum):
        violations.append(
            ResourceLimitViolation(
                resource="free_disk_bytes",
                relation="minimum",
                observed=usage.free_disk_bytes,
                limit=float(minimum),
            )
        )
    return tuple(violations)


def enforce_resource_limits(budget: ExecutionBudget, usage: ExecutionUsage) -> None:
    violations = resource_limit_violations(budget, usage)
    if violations:
        raise ResourceLimitError(violations)
