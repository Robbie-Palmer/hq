import {
  calculateHouseholdTaxPosition,
  type HouseholdTaxEstimate,
  type HouseholdTaxRequest,
} from "finance-tax-rules/household-tax";
import { z } from "zod";
import type { AssetTrackerData } from "./assetTrackerData";
import { ownershipShare, personalOwnership } from "./household";
import { flowOccurrenceDates, type RecurringFlow } from "./recurringFlow";
import { type Transfer, transferAmountTo } from "./transfer";

const EvidenceSchema = z.object({
  kind: z.enum(["observed", "assumption"]),
  timing: z.enum(["to-date", "year-end"]).optional(),
  sourceRecordId: z.string().trim().min(1),
  detail: z.string().trim().min(1),
});

export const TaxProfileSchema = z.object({
  memberId: z.string().trim().min(1),
  jurisdiction: z.enum(["england-and-northern-ireland", "scotland", "wales"]),
  residence: z.enum(["full-year-uk", "partial-year", "non-uk"]),
  hasTaxableBenefits: z.boolean(),
  nationalInsuranceCategory: z.string().trim().min(1),
  isCompanyDirector: z.boolean(),
  flexiblyAccessedPension: z.boolean(),
  evidence: EvidenceSchema,
});
export type TaxProfile = z.infer<typeof TaxProfileSchema>;

export const TaxProfileSetupSchema = TaxProfileSchema.omit({ evidence: true });
export type TaxProfileSetup = z.infer<typeof TaxProfileSetupSchema>;

export function defaultTaxProfile(memberId: string): TaxProfileSetup {
  return {
    memberId,
    jurisdiction: "england-and-northern-ireland",
    residence: "full-year-uk",
    hasTaxableBenefits: false,
    nationalInsuranceCategory: "A",
    isCompanyDirector: false,
    flexiblyAccessedPension: false,
  };
}

const TaxIncomeSchema = z.object({
  id: z.string().trim().min(1),
  memberId: z.string().trim().min(1),
  date: z.iso.date(),
  accountId: z.string().trim().min(1).optional(),
  employmentId: z.string().trim().min(1).optional(),
  kind: z.enum(["employment", "savings-interest", "dividend"]),
  amountPence: z.number().int().nonnegative(),
  evidence: EvidenceSchema,
  correctsId: z.string().trim().min(1).optional(),
});

const TaxDisposalSchema = z.object({
  id: z.string().trim().min(1),
  memberId: z.string().trim().min(1),
  date: z.iso.date(),
  accountId: z.string().trim().min(1),
  proceedsPence: z.number().int().nonnegative(),
  allowableCostPence: z.number().int().nonnegative(),
  lossesAppliedPence: z.number().int().nonnegative(),
  claimsRelief: z.boolean(),
  evidence: EvidenceSchema,
  correctsId: z.string().trim().min(1).optional(),
});

const TaxContributionSchema = z.object({
  id: z.string().trim().min(1),
  memberId: z.string().trim().min(1),
  date: z.iso.date(),
  accountId: z.string().trim().min(1),
  kind: z.enum(["isa", "pension"]),
  amountPence: z.number().int().nonnegative(),
  pensionMethod: z
    .enum(["salary-sacrifice", "net-pay", "relief-at-source"])
    .optional(),
  employerContribution: z.boolean().optional(),
  evidence: EvidenceSchema,
  correctsId: z.string().trim().min(1).optional(),
});

export const TaxPositionDataSchema = z.object({
  taxYear: z.string().regex(/^\d{4}-\d{2}$/),
  profiles: z.array(TaxProfileSchema),
  income: z.array(TaxIncomeSchema),
  disposals: z.array(TaxDisposalSchema),
  contributions: z.array(TaxContributionSchema),
  unsupportedCases: z.array(
    z.object({
      code: z.string().trim().min(1),
      detail: z.string().trim().min(1),
    }),
  ),
});
export type TaxPositionData = z.infer<typeof TaxPositionDataSchema>;

export const EMPTY_TAX_POSITION: TaxPositionData = {
  taxYear: "2026-27",
  profiles: [],
  income: [],
  disposals: [],
  contributions: [],
  unsupportedCases: [],
};

function taxYearDates(taxYear: string): { from: string; to: string } {
  const startYear = Number(taxYear.slice(0, 4));
  return { from: `${startYear}-04-06`, to: `${startYear + 1}-04-05` };
}

function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

function currentIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function flowOwnershipShare(
  data: AssetTrackerData,
  flow: RecurringFlow,
  memberId: string,
): number {
  const fallback = personalOwnership(
    data.household.members[0]?.id ?? "primary",
  );
  return ownershipShare(
    data.ownership.recurringFlows[flow.id] ?? fallback,
    memberId,
  );
}

function recurringAmountPence(input: {
  amount: number;
  data: AssetTrackerData;
  flow: RecurringFlow;
  from: string;
  memberId: string;
  to: string;
}): number {
  const dayBeforeFrom = new Date(`${input.from}T00:00:00Z`);
  dayBeforeFrom.setUTCDate(dayBeforeFrom.getUTCDate() - 1);
  const afterDate = dayBeforeFrom.toISOString().slice(0, 10);
  const occurrences = flowOccurrenceDates(input.flow, input.to, afterDate);
  return Math.round(
    occurrences.length *
      input.amount *
      flowOwnershipShare(input.data, input.flow, input.memberId) *
      100,
  );
}

function recurringTaxableEmploymentIncomePence(
  data: AssetTrackerData,
  memberId: string,
  from: string,
  to: string,
): number {
  const grossPay = data.recurringFlows
    .filter(
      (flow) =>
        flow.compensationKind === "takeHomeIncome" &&
        flow.grossAmount != null &&
        flow.currency === "GBP",
    )
    .reduce(
      (total, flow) =>
        total +
        recurringAmountPence({
          amount: flow.grossAmount ?? 0,
          data,
          flow,
          from,
          memberId,
          to,
        }),
      0,
    );
  const salarySacrifice = data.recurringFlows
    .filter(
      (flow) =>
        flow.compensationKind === "employeePension" &&
        flow.amount != null &&
        flow.currency === "GBP",
    )
    .reduce(
      (total, flow) =>
        total +
        recurringAmountPence({
          amount: flow.amount ?? 0,
          data,
          flow,
          from,
          memberId,
          to,
        }),
      0,
    );
  return Math.max(grossPay - salarySacrifice, 0);
}

export function suggestedAnnualEmploymentIncomePence(
  data: AssetTrackerData,
  memberId: string,
  taxYear: string,
): number | null {
  const { from, to } = taxYearDates(taxYear);
  const amount = recurringTaxableEmploymentIncomePence(
    data,
    memberId,
    from,
    to,
  );
  return amount > 0 ? amount : null;
}

function inferredEmploymentIncome(
  data: AssetTrackerData,
  taxYear: string,
  memberId: string,
  asOfDate: string,
): TaxPositionData["income"] {
  const { from, to } = taxYearDates(taxYear);
  const throughDate = asOfDate < from ? from : asOfDate > to ? to : asOfDate;
  const projectedPence = recurringTaxableEmploymentIncomePence(
    data,
    memberId,
    from,
    to,
  );
  if (projectedPence <= 0) return [];
  const toDatePence = recurringTaxableEmploymentIncomePence(
    data,
    memberId,
    from,
    throughDate,
  );
  const remainingPence = Math.max(projectedPence - toDatePence, 0);
  const employmentId = `recurring-flow-${memberId}`;
  return [
    ...(toDatePence <= 0
      ? []
      : [
          {
            id: `recurring-flow-employment-to-date-${memberId}-${taxYear}`,
            memberId,
            employmentId,
            date: throughDate,
            kind: "employment" as const,
            amountPence: toDatePence,
            evidence: {
              kind: "assumption" as const,
              timing: "to-date" as const,
              sourceRecordId: `recurring-taxable-pay-to-date-${memberId}-${taxYear}`,
              detail:
                "Estimated from recurring gross pay less salary-sacrifice pension contributions to date.",
            },
          },
        ]),
    ...(remainingPence <= 0
      ? []
      : [
          {
            id: `recurring-flow-employment-forecast-${memberId}-${taxYear}`,
            memberId,
            employmentId,
            date: to,
            kind: "employment" as const,
            amountPence: remainingPence,
            evidence: {
              kind: "assumption" as const,
              timing: "year-end" as const,
              sourceRecordId: `recurring-taxable-pay-forecast-${memberId}-${taxYear}`,
              detail:
                "Forecast from recurring gross pay less salary-sacrifice pension contributions for the rest of the tax year.",
            },
          },
        ]),
  ];
}

function inferredPensionContributions(
  data: AssetTrackerData,
  taxYear: string,
  memberId: string,
  asOfDate: string,
): TaxPositionData["contributions"] {
  const { from, to } = taxYearDates(taxYear);
  const throughDate = asOfDate < from ? from : asOfDate > to ? to : asOfDate;
  return data.recurringFlows.flatMap((flow) => {
    if (
      (flow.compensationKind !== "employeePension" &&
        flow.compensationKind !== "employerPension") ||
      flow.currency !== "GBP" ||
      flow.amount == null ||
      flow.toAccountId == null
    ) {
      return [];
    }
    const projectedPence = recurringAmountPence({
      amount: flow.amount,
      data,
      flow,
      from,
      memberId,
      to,
    });
    const toDatePence = recurringAmountPence({
      amount: flow.amount,
      data,
      flow,
      from,
      memberId,
      to: throughDate,
    });
    const remainingPence = Math.max(projectedPence - toDatePence, 0);
    const contribution = {
      memberId,
      accountId: flow.toAccountId,
      kind: "pension" as const,
      pensionMethod: "salary-sacrifice" as const,
      employerContribution: true,
    };
    return [
      ...(toDatePence <= 0
        ? []
        : [
            {
              ...contribution,
              id: `recurring-pension-to-date-${flow.id}-${memberId}-${taxYear}`,
              date: throughDate,
              amountPence: toDatePence,
              evidence: {
                kind: "assumption" as const,
                timing: "to-date" as const,
                sourceRecordId: `recurring-pension-to-date-${flow.id}-${memberId}-${taxYear}`,
                detail: `Estimated from the ${flow.name} recurring flow to date.`,
              },
            },
          ]),
      ...(remainingPence <= 0
        ? []
        : [
            {
              ...contribution,
              id: `recurring-pension-forecast-${flow.id}-${memberId}-${taxYear}`,
              date: to,
              amountPence: remainingPence,
              evidence: {
                kind: "assumption" as const,
                timing: "year-end" as const,
                sourceRecordId: `recurring-pension-forecast-${flow.id}-${memberId}-${taxYear}`,
                detail: `Forecast from the ${flow.name} recurring flow for the rest of the tax year.`,
              },
            },
          ]),
    ];
  });
}

function isaSubscriptionDestination(
  accounts: ReadonlyMap<string, AssetTrackerData["accounts"][number]>,
  transfer: Transfer,
  from: string,
  to: string,
): AssetTrackerData["accounts"][number] | null {
  if (
    transfer.date < from ||
    transfer.date > to ||
    transfer.toAccountId == null
  ) {
    return null;
  }
  const destination = accounts.get(transfer.toAccountId);
  const source =
    transfer.fromAccountId == null
      ? null
      : accounts.get(transfer.fromAccountId);
  return destination?.taxWrapper === "isa" &&
    destination.currency === "GBP" &&
    source?.taxWrapper !== "isa"
    ? destination
    : null;
}

function inferredIsaContributions(
  data: AssetTrackerData,
  taxYear: string,
  memberId: string,
  asOfDate: string,
): TaxPositionData["contributions"] {
  const { from, to } = taxYearDates(taxYear);
  const accounts = new Map(
    data.accounts.map((account) => [account.id, account]),
  );
  const fallbackMemberId = data.household.members[0]?.id ?? "primary";
  return data.transfers.flatMap((transfer) => {
    const destination = isaSubscriptionDestination(
      accounts,
      transfer,
      from,
      to,
    );
    if (destination == null) return [];
    const ownership = data.ownership.accounts[destination.id];
    const ownerId =
      ownership?.kind === "personal" ? ownership.memberId : fallbackMemberId;
    if (ownerId !== memberId) return [];
    const toDate = transfer.date <= asOfDate;
    return [
      {
        id: `transfer-isa-subscription-${transfer.id}`,
        memberId,
        date: transfer.date,
        accountId: destination.id,
        kind: "isa" as const,
        amountPence: Math.round(transferAmountTo(transfer) * 100),
        evidence: {
          kind: toDate ? ("observed" as const) : ("assumption" as const),
          timing: toDate ? ("to-date" as const) : ("year-end" as const),
          sourceRecordId: transfer.id,
          detail: `Recorded transfer into ${destination.name}.`,
        },
      },
    ];
  });
}

export function buildHouseholdTaxRequest(
  data: AssetTrackerData,
  asOfDate = currentIsoDate(),
): HouseholdTaxRequest {
  const taxPosition = data.taxPosition ?? EMPTY_TAX_POSITION;
  const { taxYear } = taxPosition;
  const { from, to } = taxYearDates(taxYear);
  const recordedIncome = taxPosition.income.filter(({ date }) =>
    inRange(date, from, to),
  );
  const selectedDisposals = taxPosition.disposals.filter(({ date }) =>
    inRange(date, from, to),
  );
  const recordedContributions = taxPosition.contributions.filter(({ date }) =>
    inRange(date, from, to),
  );
  const profiles = new Map(
    taxPosition.profiles.map((profile) => [profile.memberId, profile]),
  );
  const unsupportedCases = [...taxPosition.unsupportedCases];
  const people = data.household.members.map(({ id, displayName }) => {
    const profile = profiles.get(id);
    return {
      ...(profile ?? {
        ...defaultTaxProfile(id),
        evidence: {
          kind: "assumption" as const,
          sourceRecordId: `default-tax-profile-${id}-${taxYear}`,
          detail: "Standard UK tax profile supplied by Asset Tracker",
        },
      }),
      displayName,
    };
  });
  const membersWithEmploymentIncome = new Set(
    recordedIncome
      .filter(({ kind }) => kind === "employment")
      .map(({ memberId }) => memberId),
  );
  const selectedIncome = [
    ...recordedIncome,
    ...data.household.members.flatMap(({ id }) =>
      membersWithEmploymentIncome.has(id)
        ? []
        : inferredEmploymentIncome(data, taxYear, id, asOfDate),
    ),
  ];
  const membersWithPensionContributions = new Set(
    recordedContributions
      .filter(({ kind }) => kind === "pension")
      .map(({ memberId }) => memberId),
  );
  const selectedContributions = [
    ...recordedContributions,
    ...data.household.members.flatMap(({ id }) =>
      membersWithPensionContributions.has(id)
        ? []
        : inferredPensionContributions(data, taxYear, id, asOfDate),
    ),
    ...data.household.members.flatMap(({ id }) =>
      recordedContributions.some(
        ({ kind, memberId }) => kind === "isa" && memberId === id,
      )
        ? []
        : inferredIsaContributions(data, taxYear, id, asOfDate),
    ),
  ];
  const inferredPensionAccountIds = new Set(
    data.recurringFlows.flatMap((flow) =>
      (flow.compensationKind === "employeePension" ||
        flow.compensationKind === "employerPension") &&
      flow.toAccountId != null
        ? [flow.toAccountId]
        : [],
    ),
  );
  const accounts = data.accounts.flatMap(({ id, name, taxWrapper }) => {
    const wrapper =
      taxWrapper ?? (inferredPensionAccountIds.has(id) ? "pension" : null);
    if (wrapper == null) return [];
    const ownership = data.ownership.accounts[id];
    if (ownership?.kind === "shared") {
      unsupportedCases.push({
        code: "shared-tax-wrapper",
        detail: `${name} is marked as a shared ${wrapper} account. UK tax wrappers and taxable disposals need one owner in this release.`,
      });
      return [];
    }
    const memberId =
      ownership?.kind === "personal"
        ? ownership.memberId
        : (data.household.members[0]?.id ?? "primary");
    return [
      {
        id,
        name,
        memberId,
        wrapper,
        holdingRecordIds: (data.holdingObservations ?? [])
          .filter(({ accountId }) => accountId === id)
          .map(({ id: observationId }) => observationId),
      },
    ];
  });
  const wrappedAccountIds = new Set(accounts.map(({ id }) => id));
  const referencedAccountIds = [
    ...selectedIncome.flatMap(({ accountId }) =>
      accountId == null ? [] : [accountId],
    ),
    ...selectedDisposals.map(({ accountId }) => accountId),
    ...selectedContributions.map(({ accountId }) => accountId),
  ];
  for (const accountId of new Set(referencedAccountIds)) {
    if (!wrappedAccountIds.has(accountId)) {
      unsupportedCases.push({
        code: "missing-account-wrapper",
        detail: `Account ${accountId} is used by a tax record but has no supported tax wrapper and personal owner.`,
      });
    }
  }
  const wrapperByAccount = new Map(
    accounts.map(({ id, wrapper }) => [id, wrapper]),
  );
  for (const contribution of selectedContributions) {
    const expectedWrapper = contribution.kind;
    if (wrapperByAccount.get(contribution.accountId) !== expectedWrapper) {
      unsupportedCases.push({
        code: "contribution-wrapper-mismatch",
        detail: `${contribution.id} is recorded as a ${contribution.kind} contribution but its account has a different wrapper.`,
      });
    }
  }

  return {
    taxYear,
    people,
    accounts,
    incomes: selectedIncome.map(({ date: _date, ...income }) => income),
    disposals: selectedDisposals.map(
      ({ date: _date, ...disposal }) => disposal,
    ),
    contributions: selectedContributions.map(
      ({ date: _date, ...contribution }) => contribution,
    ),
    unsupportedCases,
  };
}

export function getHouseholdTaxEstimate(
  data: AssetTrackerData,
  asOfDate = currentIsoDate(),
): HouseholdTaxEstimate {
  return calculateHouseholdTaxPosition(
    buildHouseholdTaxRequest(data, asOfDate),
  );
}
