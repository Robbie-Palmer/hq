import { z } from "zod";
import { IsoDateSchema } from "./sideIncome";

export const OFF_PAYROLL_STATUS_CONTRACT_VERSION = 1 as const;

export const OffPayrollStatusEvidenceSchema = z
  .object({
    contractVersion: z.literal(OFF_PAYROLL_STATUS_CONTRACT_VERSION),
    engagementId: z.string().trim().min(1),
    engagementKind: z.enum(["services", "goods", "employment", "unknown"]),
    workerRoute: z.enum([
      "umbrella-employment",
      "direct-employment",
      "own-intermediary",
      "unknown",
    ]),
    clientCategory: z.enum([
      "public-sector",
      "private-small",
      "private-medium-or-large",
      "unknown",
    ]),
    suppliedStatus: z.enum([
      "inside",
      "outside",
      "unknown",
      "under-review",
      "not-applicable",
    ]),
    evidence: z
      .object({
        kind: z.enum([
          "status-determination-statement",
          "cest-result",
          "professional-review",
          "contract-and-working-practices",
          "none",
        ]),
        reference: z.string().trim().min(1).nullable(),
        assessedOn: IsoDateSchema.nullable(),
        reasons: z.array(z.string().trim().min(1)),
      })
      .strict(),
  })
  .strict();

export type OffPayrollStatusEvidence = z.infer<
  typeof OffPayrollStatusEvidenceSchema
>;

type StatusIssue = {
  code: string;
  state: "needs-review" | "unsupported";
  detail: string;
};

const guidance = {
  offPayrollWorking: "https://www.gov.uk/guidance/understanding-off-payroll-working-ir35",
  checkEmploymentStatus: "https://www.gov.uk/guidance/check-employment-status-for-tax",
} as const;

function responsibilityFor(
  input: OffPayrollStatusEvidence,
  relevant: boolean,
) {
  if (!relevant) return "not-applicable" as const;
  if (input.clientCategory === "private-small") {
    return "worker-intermediary" as const;
  }
  if (
    input.clientCategory === "public-sector" ||
    input.clientCategory === "private-medium-or-large"
  ) {
    return "client" as const;
  }
  return "unknown" as const;
}

function scopeIssues(
  input: OffPayrollStatusEvidence,
  relevant: boolean,
  decisionResponsibility: ReturnType<typeof responsibilityFor>,
): StatusIssue[] {
  const issues: StatusIssue[] = [];
  if (input.engagementKind === "unknown" || input.workerRoute === "unknown") {
    issues.push({
      code: "off-payroll-scope-unknown",
      state: "needs-review",
      detail: "The engagement and worker route must be known before off-payroll scope can be recorded.",
    });
  }
  if (relevant && decisionResponsibility === "unknown") {
    issues.push({
      code: "off-payroll-responsibility-unknown",
      state: "needs-review",
      detail: "The client category is needed to record who must make the status decision.",
    });
  }
  if (!relevant && input.suppliedStatus !== "not-applicable") {
    issues.push({
      code: "off-payroll-status-not-relevant",
      state: "needs-review",
      detail:
        input.workerRoute === "umbrella-employment"
          ? "Umbrella employment is an employment route, not a worker-owned intermediary status decision."
          : "This engagement is not recorded as services through the worker's own intermediary.",
    });
  }
  return issues;
}

function suppliedEvidenceIssues(
  input: OffPayrollStatusEvidence,
  relevant: boolean,
): StatusIssue[] {
  if (!relevant) return [];
  if (
    input.suppliedStatus === "unknown" ||
    input.suppliedStatus === "under-review"
  ) {
    return [
      {
        code: "off-payroll-status-unresolved",
        state: "needs-review",
        detail: "No final status decision has been supplied for this service engagement.",
      },
    ];
  }
  const finalStatus =
    input.suppliedStatus === "inside" || input.suppliedStatus === "outside";
  const incomplete =
    input.evidence.kind === "none" ||
    input.evidence.reference === null ||
    input.evidence.assessedOn === null ||
    input.evidence.reasons.length === 0;
  return finalStatus && incomplete
    ? [
        {
          code: "off-payroll-evidence-incomplete",
          state: "needs-review",
          detail: "A supplied inside or outside status needs dated evidence, a reference, and reasons.",
        },
      ]
    : [];
}

export function evaluateOffPayrollStatusEvidence(
  value: OffPayrollStatusEvidence,
) {
  const input = OffPayrollStatusEvidenceSchema.parse(value);
  const relevant =
    input.engagementKind === "services" && input.workerRoute === "own-intermediary";
  const decisionResponsibility = responsibilityFor(input, relevant);
  const issues = [
    ...scopeIssues(input, relevant, decisionResponsibility),
    ...suppliedEvidenceIssues(input, relevant),
  ];

  return {
    kind: "uk-off-payroll-status-evidence" as const,
    contractVersion: OFF_PAYROLL_STATUS_CONTRACT_VERSION,
    engagementId: input.engagementId,
    relevant,
    decisionResponsibility,
    status: relevant ? input.suppliedStatus : ("not-applicable" as const),
    evidence: input.evidence,
    issues,
    guidance,
    separation: {
      inferredFromFinancialOutcome: false,
      financialComparisonCanChangeStatus: false,
    },
  };
}

export type OffPayrollStatusResult = ReturnType<
  typeof evaluateOffPayrollStatusEvidence
>;
