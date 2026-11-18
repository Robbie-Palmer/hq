import { addMonths, format, max, parseISO } from "date-fns";
import { IsoDateSchema } from "personal-finance-contracts/side-income";
import { type AccountAccessPolicy, AccountAccessPolicySchema } from "./account";

export const BUSINESS_FI_PENSION_CALCULATION_VERSION =
  "business-fi-pension-v1" as const;

export type BusinessFiPensionIssue = {
  kind:
    | "invalid-pension-date"
    | "pension-access-date-required"
    | "pension-spending-disabled"
    | "unsupported-pension-tax-treatment";
  detail: string;
};

export type BusinessFiPensionTreatment = {
  accountId: string;
  accessPolicy: AccountAccessPolicy;
  inputRecordIds: readonly string[];
};

export type BusinessFiPensionContribution = {
  calculationVersion: typeof BUSINESS_FI_PENSION_CALCULATION_VERSION;
  id: string;
  accountId: string;
  contributedOn: string;
  accessibleOn: string | null;
  grossPence: number;
  withdrawalTaxPence: number | null;
  withdrawalFeePence: number;
  fiEligiblePence: number;
  pensionWealthAddedPence: number;
  alreadyReflected: boolean;
  supported: boolean;
  inputRecordIds: string[];
  issues: BusinessFiPensionIssue[];
};

const roundPence = (amount: number): number => Math.round(amount);

function accessibleOn(
  planningDate: string,
  contributedOn: string,
  policy: AccountAccessPolicy,
): string | null {
  if (policy.accessibleFromDate == null) return null;
  const delayedFromPlan = addMonths(
    parseISO(planningDate),
    policy.accessDelayMonths,
  );
  return format(
    max([
      delayedFromPlan,
      parseISO(contributedOn),
      parseISO(policy.accessibleFromDate),
    ]),
    "yyyy-MM-dd",
  );
}

function pensionDateIssues(
  planningDate: string,
  contributedOn: string,
): BusinessFiPensionIssue[] {
  return [
    ["planning", planningDate],
    ["contribution", contributedOn],
  ].flatMap(([label, date]) =>
    IsoDateSchema.safeParse(date).success
      ? []
      : [
          {
            kind: "invalid-pension-date" as const,
            detail: `The ${label} date ${date} is not a valid YYYY-MM-DD calendar date.`,
          },
        ],
  );
}

function pensionPolicyIssues(
  policy: AccountAccessPolicy,
  accessDate: string | null,
  datesAreValid: boolean,
): BusinessFiPensionIssue[] {
  const issues: BusinessFiPensionIssue[] = [];
  if (datesAreValid && accessDate == null) {
    issues.push({
      kind: "pension-access-date-required",
      detail:
        "The pension contribution has no dated route to ordinary spending.",
    });
  }
  if (policy.canFundOrdinarySpending !== true) {
    issues.push({
      kind: "pension-spending-disabled",
      detail: "The pension account cannot fund ordinary spending.",
    });
  }
  if (policy.taxTreatment?.kind === "unsupported") {
    issues.push({
      kind: "unsupported-pension-tax-treatment",
      detail: policy.taxTreatment.reason,
    });
  } else if (policy.taxTreatment == null) {
    issues.push({
      kind: "unsupported-pension-tax-treatment",
      detail: "The pension withdrawal tax treatment has not been recorded.",
    });
  }
  return issues;
}

export function evaluateBusinessFiPensionContribution(input: {
  id: string;
  planningDate: string;
  contributedOn: string;
  grossPence: number;
  treatment: BusinessFiPensionTreatment;
  alreadyReflected: boolean;
  inputRecordIds: readonly string[];
}): BusinessFiPensionContribution {
  if (!Number.isInteger(input.grossPence) || input.grossPence < 0) {
    throw new Error(
      "A business pension contribution must be whole non-negative pence",
    );
  }
  const policy = AccountAccessPolicySchema.parse(input.treatment.accessPolicy);
  const dateIssues = pensionDateIssues(input.planningDate, input.contributedOn);
  const accessDate =
    dateIssues.length === 0
      ? accessibleOn(input.planningDate, input.contributedOn, policy)
      : null;
  const issues = [
    ...dateIssues,
    ...pensionPolicyIssues(policy, accessDate, dateIssues.length === 0),
  ];

  const supported = issues.length === 0;
  let withdrawalTaxPence: number | null = null;
  if (policy.taxTreatment?.kind === "fixed-rate") {
    withdrawalTaxPence = roundPence(
      input.grossPence * policy.taxTreatment.rate,
    );
  } else if (policy.taxTreatment?.kind === "tax-free") {
    withdrawalTaxPence = 0;
  }
  const withdrawalFeePence = roundPence(
    input.grossPence * policy.withdrawalFeeRate,
  );
  const counted = supported && !input.alreadyReflected;
  return {
    calculationVersion: BUSINESS_FI_PENSION_CALCULATION_VERSION,
    id: input.id,
    accountId: input.treatment.accountId,
    contributedOn: input.contributedOn,
    accessibleOn: accessDate,
    grossPence: input.grossPence,
    withdrawalTaxPence,
    withdrawalFeePence,
    fiEligiblePence: counted
      ? Math.max(
          0,
          input.grossPence - (withdrawalTaxPence ?? 0) - withdrawalFeePence,
        )
      : 0,
    pensionWealthAddedPence:
      input.alreadyReflected || !supported ? 0 : input.grossPence,
    alreadyReflected: input.alreadyReflected,
    supported,
    inputRecordIds: [
      ...new Set([...input.inputRecordIds, ...input.treatment.inputRecordIds]),
    ],
    issues,
  };
}
