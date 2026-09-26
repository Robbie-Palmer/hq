import { describe, expect, it } from "vitest";

import {
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
      { code: "interest-match", value: 1 },
      { code: "declared-capability-margin", value: 1 },
      { code: "observed-capability-confidence", value: 0.9 },
      { code: "preferred-tool-match", value: 1 },
      { code: "available-capacity", value: 2 },
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
      "required-access-missing",
      "required-authority-missing",
      "verified-capability-missing",
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

  it("returns the same ordered result for repeated evaluations", () => {
    expect(evaluateCompatibility(compatibleInput)).toEqual(
      evaluateCompatibility(compatibleInput),
    );
  });
});
