import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadFeatureFlagContract,
  loadFeatureFlagEvaluationFixture,
  parseFeatureFlagEvaluationFixture,
  validateFeatureFlagConformance,
} from "./check-feature-flag-contract.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

describe("feature flag contract", () => {
  it("accepts the provider matrix and cross-language fixture", async () => {
    const contract = await loadFeatureFlagContract(repositoryRoot);
    const fixture = await loadFeatureFlagEvaluationFixture(
      repositoryRoot,
      contract,
    );

    await expect(
      validateFeatureFlagConformance(repositoryRoot, contract, fixture),
    ).resolves.toEqual([]);
  });

  it("rejects a missing supported value type", async () => {
    const contract = await loadFeatureFlagContract(repositoryRoot);
    const fixture = await loadFeatureFlagEvaluationFixture(
      repositoryRoot,
      contract,
    );
    fixture.evaluations = fixture.evaluations.filter(
      ({ type }) => type !== "object",
    );

    await expect(
      validateFeatureFlagConformance(repositoryRoot, contract, fixture),
    ).resolves.toContain(
      "Evaluation fixtures must cover every supported type exactly once",
    );
  });

  it("rejects an unsafe stale result for a critical flag", async () => {
    const contract = await loadFeatureFlagContract(repositoryRoot);
    const fixture = await loadFeatureFlagEvaluationFixture(
      repositoryRoot,
      contract,
    );
    const staleCritical = fixture.safeDefaults.find(
      ({ case: name }) => name === "stale-critical",
    );
    if (!staleCritical) throw new Error("Missing stale-critical fixture");
    staleCritical.expected = true;

    await expect(
      validateFeatureFlagConformance(repositoryRoot, contract, fixture),
    ).resolves.toContain(
      "stale-critical: expected value violates the state policy",
    );
  });

  it("rejects incomplete runtime, fixture, and provider coverage", async () => {
    const contract = await loadFeatureFlagContract(repositoryRoot);
    const fixture = await loadFeatureFlagEvaluationFixture(
      repositoryRoot,
      contract,
    );
    contract.providers.nodejs.provider = "UnofficialProvider";
    contract.testing.required_runtimes = ["nodejs"];
    fixture.evaluations[1] = structuredClone(fixture.evaluations[0]);
    fixture.safeDefaults = fixture.safeDefaults.filter(
      ({ case: name }) => name !== "offline",
    );

    await expect(
      validateFeatureFlagConformance(repositoryRoot, contract, fixture),
    ).resolves.toEqual(
      expect.arrayContaining([
        "nodejs: provider is not the official PostHog provider",
        "Duplicate evaluation fixture 'checkout-kill-switch'",
        "Duplicate evaluation type 'boolean'",
        "Safe-default fixtures must cover missing, offline, stale, and not-ready states",
        "Contract must require every supported runtime exactly once",
      ]),
    );
  });

  it("rejects provider versions that are not pinned in test projects", async () => {
    const contract = await loadFeatureFlagContract(repositoryRoot);
    const fixture = await loadFeatureFlagEvaluationFixture(
      repositoryRoot,
      contract,
    );
    contract.providers.browser_javascript.tested_version = "999.0.0";
    contract.providers.python.backing_sdk_tested_version = "999.0.0";

    await expect(
      validateFeatureFlagConformance(repositoryRoot, contract, fixture),
    ).resolves.toEqual(
      expect.arrayContaining([
        "@posthog/openfeature-web-provider: expected pinned test dependency 999.0.0",
        "posthog: expected pinned Python test dependency 999.0.0",
      ]),
    );
  });

  it("rejects malformed fixture fields", () => {
    expect(() =>
      parseFeatureFlagEvaluationFixture({ schemaVersion: 1 }),
    ).toThrow("Invalid feature flag evaluation fixture");
  });
});
