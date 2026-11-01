from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, cast

import pytest
from openfeature import api
from openfeature.contrib.provider.posthog import PostHogProvider
from openfeature.evaluation_context import EvaluationContext
from openfeature.exception import ErrorCode
from openfeature.flag_evaluation import FlagResolutionDetails
from posthog import Posthog
from posthog.types import FeatureFlagResult

FIXTURE_PATH = (
    Path(__file__).parents[4]
    / "ui/content/projects/personal-engineering-platform"
    / "feature-flag-conformance/evaluations.json"
)


def load_fixture() -> dict[str, Any]:
    return cast(dict[str, Any], json.loads(FIXTURE_PATH.read_text(encoding="utf-8")))


class FakePostHog:
    def __init__(
        self,
        evaluations: dict[str, dict[str, Any]],
        *,
        failure: Exception | None = None,
        secret_key: str | None = None,
    ) -> None:
        self.evaluations = evaluations
        self.failure = failure
        self.secret_key = secret_key
        self.exposures: list[dict[str, Any]] = []
        self.calls: list[dict[str, Any]] = []
        self.load_calls = 0

    def load_feature_flags(self) -> None:
        self.load_calls += 1

    def get_feature_flag_result(
        self,
        key: str,
        distinct_id: str,
        *,
        groups: dict[str, Any] | None = None,
        person_properties: dict[str, Any] | None = None,
        group_properties: dict[str, Any] | None = None,
        send_feature_flag_events: bool = True,
    ) -> FeatureFlagResult | None:
        if self.failure:
            raise self.failure
        evaluation = self.evaluations.get(key)
        self.calls.append(
            {
                "key": key,
                "distinct_id": distinct_id,
                "groups": groups,
                "person_properties": person_properties,
                "group_properties": group_properties,
            }
        )
        if evaluation is None:
            return None
        result = evaluation["result"]
        resolved = FeatureFlagResult(
            key=key,
            enabled=result["enabled"],
            variant=result["variant"],
            payload=result["payload"],
            reason=result["reason"],
        )
        if send_feature_flag_events:
            self.exposures.append(
                {
                    "event": "$feature_flag_called",
                    "key": key,
                    "response": resolved.get_value(),
                }
            )
        return resolved


def provider(fake: FakePostHog) -> PostHogProvider:
    return PostHogProvider(
        cast(Posthog, fake),
        send_feature_flag_events=True,
    )


def context(fixture: dict[str, Any]) -> EvaluationContext:
    source = fixture["context"]
    return EvaluationContext(
        targeting_key=source["targetingKey"],
        attributes={
            **source["personProperties"],
            "groups": source["groups"],
            "group_properties": source["groupProperties"],
        },
    )


def resolve(
    posthog_provider: PostHogProvider,
    evaluation: dict[str, Any],
    evaluation_context: EvaluationContext,
) -> FlagResolutionDetails[
    bool | str | int | Sequence[Any] | Mapping[str, Any]
]:
    value_type = evaluation["type"]
    if value_type == "boolean":
        return posthog_provider.resolve_boolean_details(
            evaluation["key"], evaluation["default"], evaluation_context
        )
    if value_type == "string":
        return posthog_provider.resolve_string_details(
            evaluation["key"], evaluation["default"], evaluation_context
        )
    if value_type == "number":
        return posthog_provider.resolve_integer_details(
            evaluation["key"], evaluation["default"], evaluation_context
        )
    if value_type == "object":
        return posthog_provider.resolve_object_details(
            evaluation["key"], evaluation["default"], evaluation_context
        )
    raise AssertionError(f"Unknown value type: {value_type}")


def test_official_provider_resolves_shared_typed_fixtures() -> None:
    fixture = load_fixture()
    evaluations = {item["key"]: item for item in fixture["evaluations"]}
    fake = FakePostHog(evaluations, secret_key="test-only-secret")
    posthog_provider = provider(fake)
    evaluation_context = context(fixture)

    posthog_provider.initialize(evaluation_context)
    for evaluation in fixture["evaluations"]:
        details = resolve(posthog_provider, evaluation, evaluation_context)
        assert details.value == evaluation["expected"]["value"]
        assert details.reason == evaluation["expected"]["reason"]
        assert details.variant == evaluation["expected"].get("variant")

    assert fake.load_calls == 1
    assert len(fake.calls) == len(fixture["evaluations"])
    assert len(fake.exposures) == len(fixture["evaluations"])
    assert {
        "event": "$feature_flag_called",
        "key": "checkout-experiment",
        "response": "test",
    } in fake.exposures
    assert fake.calls[0] == {
        "key": "checkout-kill-switch",
        "distinct_id": "person-123",
        "groups": {"company": "company-7"},
        "person_properties": {"plan": "pro", "region": "eu"},
        "group_properties": {"company": {"tier": "enterprise"}},
    }


@pytest.mark.parametrize(
    ("fake", "expected_error"),
    [
        (FakePostHog({}), ErrorCode.FLAG_NOT_FOUND),
        (FakePostHog({}, failure=OSError("offline")), ErrorCode.GENERAL),
    ],
)
def test_missing_and_offline_flags_use_the_safe_default(
    fake: FakePostHog,
    expected_error: ErrorCode,
) -> None:
    api.set_provider_and_wait(provider(fake))
    details = api.get_client("python-safe-default").get_boolean_details(
        "checkout-kill-switch",
        False,
        EvaluationContext(targeting_key="person-123"),
    )

    assert details.value is False
    assert details.error_code == expected_error
    assert fake.exposures == []


def test_existing_client_uses_an_awaited_replacement_provider() -> None:
    fixture = load_fixture()
    kill_switch = next(
        item for item in fixture["evaluations"] if item["key"] == "checkout-kill-switch"
    )
    enabled = FakePostHog({kill_switch["key"]: kill_switch})
    api.set_provider_and_wait(provider(enabled))
    client = api.get_client("python-replacement")
    evaluation_context = EvaluationContext(targeting_key="person-123")
    assert client.get_boolean_value(kill_switch["key"], False, evaluation_context) is True

    disabled_result = {**kill_switch["result"], "enabled": False, "reason": "no_match"}
    disabled_flag = {**kill_switch, "result": disabled_result}
    disabled = FakePostHog({disabled_flag["key"]: disabled_flag})
    api.set_provider_and_wait(provider(disabled))

    assert client.get_boolean_value(kill_switch["key"], True, evaluation_context) is False
    assert len(enabled.exposures) == 1
    assert len(disabled.exposures) == 1


def test_shared_stale_policy_protects_critical_flags() -> None:
    fixture = load_fixture()
    for test_case in fixture["safeDefaults"]:
        if test_case["state"] == "ready" or (
            test_case["state"] == "stale" and not test_case["critical"]
        ):
            value = test_case.get("cached", test_case["default"])
        else:
            value = test_case["default"]
        assert value == test_case["expected"]
