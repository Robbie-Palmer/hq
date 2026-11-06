import { describe, expect, it } from "vitest";
import {
  evaluateOffPayrollStatusEvidence,
  OFF_PAYROLL_STATUS_CONTRACT_VERSION,
  type OffPayrollStatusEvidence,
} from "../src/offPayrollStatus";

const evidence = (overrides: Partial<OffPayrollStatusEvidence> = {}) => ({
  contractVersion: OFF_PAYROLL_STATUS_CONTRACT_VERSION,
  engagementId: "engagement:client",
  engagementKind: "services" as const,
  workerRoute: "own-intermediary" as const,
  clientCategory: "private-medium-or-large" as const,
  suppliedStatus: "outside" as const,
  evidence: {
    kind: "cest-result" as const,
    reference: "cest:result:1",
    assessedOn: "2026-11-06",
    reasons: ["The saved CEST answers match the working practices."],
  },
  ...overrides,
});

describe("off-payroll status evidence", () => {
  it("preserves a supplied status and records client responsibility", () => {
    const result = evaluateOffPayrollStatusEvidence(evidence());

    expect(result).toMatchObject({
      relevant: true,
      decisionResponsibility: "client",
      status: "outside",
      issues: [],
      separation: {
        inferredFromFinancialOutcome: false,
        financialComparisonCanChangeStatus: false,
      },
    });
    expect(result.guidance.checkEmploymentStatus).toBe(
      "https://www.gov.uk/guidance/check-employment-status-for-tax",
    );
  });

  it("assigns a private-small-client decision to the worker's intermediary", () => {
    const result = evaluateOffPayrollStatusEvidence(
      evidence({ clientCategory: "private-small", suppliedStatus: "inside" }),
    );

    expect(result.decisionResponsibility).toBe("worker-intermediary");
    expect(result.status).toBe("inside");
  });

  it("keeps unknown status and responsibility as review states", () => {
    const result = evaluateOffPayrollStatusEvidence(
      evidence({
        clientCategory: "unknown",
        suppliedStatus: "under-review",
        evidence: {
          kind: "none",
          reference: null,
          assessedOn: null,
          reasons: [],
        },
      }),
    );

    expect(result.decisionResponsibility).toBe("unknown");
    expect(result.status).toBe("under-review");
    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "off-payroll-responsibility-unknown",
        "off-payroll-status-unresolved",
      ]),
    );
  });

  it("does not relabel umbrella employment as inside IR35", () => {
    const result = evaluateOffPayrollStatusEvidence(
      evidence({
        workerRoute: "umbrella-employment",
        suppliedStatus: "inside",
      }),
    );

    expect(result).toMatchObject({
      relevant: false,
      decisionResponsibility: "not-applicable",
      status: "not-applicable",
    });
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "off-payroll-status-not-relevant" }),
    );
  });

  it("requires dated reasons for an inside or outside decision", () => {
    const result = evaluateOffPayrollStatusEvidence(
      evidence({
        evidence: {
          kind: "professional-review",
          reference: null,
          assessedOn: null,
          reasons: [],
        },
      }),
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "off-payroll-evidence-incomplete" }),
    );
  });

  it("records unknown engagement scope without inventing applicability", () => {
    const result = evaluateOffPayrollStatusEvidence(
      evidence({
        engagementKind: "unknown",
        workerRoute: "unknown",
        suppliedStatus: "unknown",
      }),
    );

    expect(result.relevant).toBe(false);
    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "off-payroll-scope-unknown",
        "off-payroll-status-not-relevant",
      ]),
    );
  });
});
