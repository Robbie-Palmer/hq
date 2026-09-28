import { describe, expect, it } from "vitest";
import {
  guardrailPolicy,
  manualGuardrailStatement,
  selectPublishedFindings,
} from "../src/guardrails";

function finding(
  id: string,
  severity: "critical" | "high" | "medium" | "low",
  confidence: number,
  recommendation = "Replace the unchecked access with a guarded lookup.",
) {
  return {
    findingId: `f_${id.repeat(24)}`,
    severity,
    confidence,
    file: `${id}.ts`,
    line: 1,
    title: `${id} defect`,
    evidence: "The changed code dereferences a missing value.",
    recommendation,
    status: "open" as const,
  };
}

describe("AI review guardrails", () => {
  it("caps visible findings by a deterministic severity and confidence order", () => {
    const policy = { ...guardrailPolicy({}).publication, maxVisibleFindings: 2 };
    const findings = [
      finding("a", "medium", 0.9),
      finding("b", "critical", 0.7),
      finding("c", "high", 0.8),
      finding("d", "critical", 0.95),
    ];

    const first = selectPublishedFindings(findings, policy);
    const second = selectPublishedFindings([...findings].reverse(), policy);

    expect(first).toEqual(second);
    expect(first.published.map(({ findingId }) => findingId)).toEqual([
      `f_${"d".repeat(24)}`,
      `f_${"b".repeat(24)}`,
    ]);
    expect(first.hidden).toHaveLength(2);
    expect(first.hidden.every(({ reason }) => reason === "publication-limit"))
      .toBe(true);
  });

  it("withholds speculative language but preserves resolved updates", () => {
    const speculative = finding(
      "a",
      "high",
      0.9,
      "Consider checking this value. No fix is needed if callers are trusted.",
    );
    const resolved = {
      ...finding("b", "low", 0.5, "No fix needed."),
      status: "resolved" as const,
    };
    const result = selectPublishedFindings(
      [speculative, resolved],
      guardrailPolicy({}).publication,
    );

    expect(result.published).toEqual([resolved]);
    expect(result.hidden).toEqual([
      { finding: speculative, reason: "speculative-language" },
    ]);
  });

  it("applies the configured language policy anywhere in a finding", () => {
    const policy = guardrailPolicy({}).publication;
    const speculative = finding(
      "a",
      "high",
      0.9,
      "Add a guard and verify the value before dereferencing it.",
    );

    expect(selectPublishedFindings([speculative], policy).hidden).toEqual([
      { finding: speculative, reason: "speculative-language" },
    ]);
    expect(
      selectPublishedFindings(
        [speculative],
        { ...policy, rejectedLanguage: [] },
      ).published,
    ).toEqual([speculative]);
  });

  it("bounds configuration and reports both active policy versions", () => {
    const policy = guardrailPolicy({
      AI_REVIEW_MAX_VISIBLE_FINDINGS: "999",
      AI_REVIEW_MODEL_FAILURE_THRESHOLD: "0",
      AI_REVIEW_MODEL_COOLDOWN_SECONDS: "invalid",
      AI_REVIEW_PUBLICATION_POLICY_VERSION: "publication-v2",
      AI_REVIEW_RELIABILITY_POLICY_VERSION: "reliability-v2",
    });

    expect(policy.publication.maxVisibleFindings).toBe(25);
    expect(policy.reliability.consecutiveFailureThreshold).toBe(1);
    expect(policy.reliability.cooldownSeconds).toBe(3_600);
    expect(manualGuardrailStatement(policy)).toContain("publication-v2");
    expect(manualGuardrailStatement(policy)).toContain("reliability-v2");
  });
});
