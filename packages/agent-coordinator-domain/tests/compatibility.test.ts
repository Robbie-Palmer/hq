import { describe, expect, it } from "vitest";

import {
  CompatibilityInputSchema,
  CompatibilityResultSchema,
  evaluateCompatibility,
} from "../src";
import { actor, compatibleInput } from "./fixtures";

describe("compatibility", () => {
  it("keeps hard eligibility separate from ranking signals", () => {
    const result = evaluateCompatibility(compatibleInput);

    expect(result.eligible).toBe(true);
    expect(result.hardExclusions).toEqual([]);
    expect(result.rankingSignals).toMatchObject([
      { code: "work-class-preference", value: 1 },
      { code: "tag-preference-match", value: 1 },
      {
        code: "declared-capability-margin",
        subject: "typescript-domain-modeling",
        value: 1,
      },
      {
        code: "observed-capability-margin",
        subject: "typescript-domain-modeling",
        value: 0,
      },
      { code: "preferred-tool-match", value: 1 },
      {
        code: "capacity-headroom",
        subject: "provider-context",
        value: 36_000,
        unit: "tokens",
      },
      {
        code: "capacity-headroom",
        subject: "account-budget",
        value: 7,
        unit: "credits",
      },
      { code: "estimated-session-cost", value: 2, unit: "USD" },
    ]);
    expect(
      CompatibilityResultSchema.parse(JSON.parse(JSON.stringify(result))),
    ).toEqual(result);
  });

  it("excludes an actor when authority, access, capability, or evidence is missing", () => {
    const result = evaluateCompatibility({
      ...compatibleInput,
      actor: {
        ...actor,
        grantedAuthority: [],
        access: [],
        declaredCapabilities: [],
        observedCapabilities: [],
      },
      adapter: {
        ...compatibleInput.adapter,
        evidenceKinds: [],
        supportsCheckpointing: false,
      },
    });

    expect(result.eligible).toBe(false);
    expect(result.hardExclusions.map(({ code }) => code)).toEqual([
      "capability-missing",
      "checkpoint-unsupported",
      "evidence-unsupported",
      "evidence-unsupported",
      "observed-capability-missing",
      "required-access-missing",
      "required-authority-missing",
    ]);
    expect(result.rankingSignals.length).toBeGreaterThan(0);
  });

  it("enforces authentication, budget, and concurrency policy", () => {
    const result = evaluateCompatibility({
      ...compatibleInput,
      policy: {
        ...compatibleInput.policy,
        allowedAuthenticationPaths: ["auth:other"],
        budgets: [
          {
            workClass: "code.change",
            maximumPerSession: { currency: "USD", amount: 1 },
            remaining: { currency: "USD", amount: 1 },
          },
        ],
        concurrency: {
          maximumActiveSessions: 1,
          maximumActiveSessionsPerActor: 0,
          workClasses: [],
        },
      },
    });

    expect(result.eligible).toBe(false);
    expect(result.hardExclusions.map(({ code }) => code)).toEqual([
      "actor-concurrency-exhausted",
      "authentication-path-denied",
      "remaining-budget-exhausted",
      "session-budget-exceeded",
      "total-concurrency-exhausted",
    ]);
  });

  it("excludes work classes outside owner policy", () => {
    const result = evaluateCompatibility({
      ...compatibleInput,
      policy: {
        ...compatibleInput.policy,
        allowedWorkClasses: ["documentation"],
        budgets: [],
        concurrency: {
          ...compatibleInput.policy.concurrency,
          workClasses: [],
        },
      },
    });

    expect(result.hardExclusions.map(({ code }) => code)).toContain(
      "work-class-denied",
    );
  });

  it("uses routing preferences only as ranking signals", () => {
    const result = evaluateCompatibility({
      ...compatibleInput,
      actor: {
        ...actor,
        routingPreferences: { workClasses: [], tags: [] },
      },
    });

    expect(result.eligible).toBe(true);
    expect(
      result.rankingSignals.filter(({ code }) =>
        ["work-class-preference", "tag-preference-match"].includes(code),
      ),
    ).toMatchObject([
      { code: "work-class-preference", value: 0 },
      { code: "tag-preference-match", value: 0 },
    ]);
  });

  it("excludes actors without enough named resources in matching units", () => {
    const result = evaluateCompatibility({
      ...compatibleInput,
      actor: {
        ...actor,
        resourceAvailability: actor.resourceAvailability.map((resource) =>
          resource.resource === "provider-context"
            ? { ...resource, amount: 1_000 }
            : { ...resource, unit: "tokens" },
        ),
      },
    });

    expect(result.hardExclusions.map(({ code }) => code)).toEqual([
      "capacity-insufficient",
      "capacity-unit-mismatch",
    ]);
  });

  it("takes complexity ordering from the supplied scale", () => {
    const limitedActor = {
      ...actor,
      complexityLimits: actor.complexityLimits.map((limit) => ({
        ...limit,
        levelId: "bounded-change",
      })),
    };
    expect(
      evaluateCompatibility({ ...compatibleInput, actor: limitedActor })
        .hardExclusions,
    ).toMatchObject([{ code: "complexity-unsupported" }]);

    const reorderedScale = {
      ...compatibleInput.complexityScale,
      levels: compatibleInput.complexityScale.levels.map((level) => ({
        ...level,
        rank:
          level.levelId === "bounded-change"
            ? 20
            : level.levelId === "cross-cutting-change"
              ? 10
              : level.rank,
      })),
    };
    expect(
      evaluateCompatibility({
        ...compatibleInput,
        actor: limitedActor,
        complexityScale: reorderedScale,
      }).eligible,
    ).toBe(true);
  });

  it("rejects complexity references absent from the supplied scale", () => {
    expect(
      CompatibilityInputSchema.safeParse({
        ...compatibleInput,
        task: {
          ...compatibleInput.task,
          complexity: {
            ...compatibleInput.task.complexity,
            levelId: "undefined-level",
          },
        },
      }).success,
    ).toBe(false);
  });

  it("returns the same ordered result for repeated evaluations", () => {
    expect(evaluateCompatibility(compatibleInput)).toEqual(
      evaluateCompatibility(compatibleInput),
    );
  });
});
