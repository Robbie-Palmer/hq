import {
  calculateHouseholdTaxPosition,
  type HouseholdTaxEstimate,
  type HouseholdTaxRequest,
} from "finance-tax-rules/household-tax";
import { z } from "zod";
import type { AssetTrackerData } from "./assetTrackerData";

const EvidenceSchema = z.object({
  kind: z.enum(["observed", "assumption"]),
  sourceRecordId: z.string().trim().min(1),
  detail: z.string().trim().min(1),
});

const TaxProfileSchema = z.object({
  memberId: z.string().trim().min(1),
  jurisdiction: z.enum(["england-and-northern-ireland", "scotland", "wales"]),
  residence: z.enum(["full-year-uk", "partial-year", "non-uk"]),
  hasTaxableBenefits: z.boolean(),
  nationalInsuranceCategory: z.string().trim().min(1),
  isCompanyDirector: z.boolean(),
  flexiblyAccessedPension: z.boolean(),
  evidence: EvidenceSchema,
});

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

export function buildHouseholdTaxRequest(
  data: AssetTrackerData,
): HouseholdTaxRequest {
  const taxPosition = data.taxPosition ?? EMPTY_TAX_POSITION;
  const { taxYear } = taxPosition;
  const { from, to } = taxYearDates(taxYear);
  const selectedIncome = taxPosition.income.filter(({ date }) =>
    inRange(date, from, to),
  );
  const selectedDisposals = taxPosition.disposals.filter(({ date }) =>
    inRange(date, from, to),
  );
  const selectedContributions = taxPosition.contributions.filter(({ date }) =>
    inRange(date, from, to),
  );
  const profiles = new Map(
    taxPosition.profiles.map((profile) => [profile.memberId, profile]),
  );
  const unsupportedCases = [...taxPosition.unsupportedCases];
  const people = data.household.members.flatMap(({ id, displayName }) => {
    const profile = profiles.get(id);
    if (profile == null) {
      unsupportedCases.push({
        code: "missing-tax-profile",
        detail: `${displayName} has no tax profile for ${taxYear}.`,
      });
      return [];
    }
    return [{ ...profile, displayName }];
  });
  const accounts = data.accounts.flatMap(({ id, name, taxWrapper }) => {
    if (taxWrapper == null) return [];
    const ownership = data.ownership.accounts[id];
    if (ownership?.kind === "shared") {
      unsupportedCases.push({
        code: "shared-tax-wrapper",
        detail: `${name} is marked as a shared ${taxWrapper} account. UK tax wrappers and taxable disposals need one owner in this release.`,
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
        wrapper: taxWrapper,
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
): HouseholdTaxEstimate {
  return calculateHouseholdTaxPosition(buildHouseholdTaxRequest(data));
}
