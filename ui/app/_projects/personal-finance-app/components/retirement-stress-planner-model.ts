"use client";

import { addYears, format } from "date-fns";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { z } from "zod";
import {
  type AccountAccessPolicy,
  type AccountDetailView,
  compareRetirementProjectionRanges,
  isLiability,
  type RetirementAssumptionSet,
  type RetirementCapitalAccount,
  type RetirementProjectionFacts,
  type RetirementProjectionRangeComparison,
} from "@/app/_projects/personal-finance-app/domain";

const STORAGE_KEY = "assettracker:retirement-stress-planner:v1";

export type RetirementStressDraft = {
  startDate: string;
  plannedRetirementDate: string;
  annualSpending: number;
  annualNetEmploymentIncome: number;
  delayedIncomeAnnual: number;
  delayedIncomeStartDate: string;
  pensionAccessDate: string;
  taxableWithdrawalTaxRate: number;
  pensionWithdrawalTaxRate: number;
  retireEarlierYears: number;
  workLongerYears: number;
  lowerIncomeRate: number;
  assumptionSets: RetirementAssumptionSet[];
};

export type RetirementPlannerAccount = Pick<
  AccountDetailView,
  | "id"
  | "name"
  | "provider"
  | "currency"
  | "assetType"
  | "liquidity"
  | "taxWrapper"
  | "accessPolicy"
  | "expectedAnnualReturn"
  | "expectedReturnChanges"
  | "isOpen"
  | "latestBalance"
>;

const AssumptionSetSchema: z.ZodType<RetirementAssumptionSet> = z.object({
  id: z.string().trim().min(1),
  name: z.string(),
  annualReturn: z.number().finite(),
  annualInflation: z.number().finite(),
  annualSpendingChange: z.number().finite(),
  annualFeeRate: z.number().finite(),
  longevityYears: z.number().finite(),
  earlyReturnShock: z.number().finite(),
  earlyReturnShockYears: z.number().finite(),
});

const RetirementStressDraftSchema: z.ZodType<RetirementStressDraft> = z.object({
  startDate: z.iso.date(),
  plannedRetirementDate: z.iso.date(),
  annualSpending: z.number().finite(),
  annualNetEmploymentIncome: z.number().finite(),
  delayedIncomeAnnual: z.number().finite(),
  delayedIncomeStartDate: z.iso.date(),
  pensionAccessDate: z.iso.date(),
  taxableWithdrawalTaxRate: z.number().finite(),
  pensionWithdrawalTaxRate: z.number().finite(),
  retireEarlierYears: z.number().finite(),
  workLongerYears: z.number().finite(),
  lowerIncomeRate: z.number().finite(),
  assumptionSets: z.array(AssumptionSetSchema),
});

function dateYearsFrom(date: Date, years: number): string {
  return format(addYears(date, years), "yyyy-MM-dd");
}

function initialDraft(annualSpending: number): RetirementStressDraft {
  const start = new Date();
  start.setDate(1);
  return {
    startDate: format(start, "yyyy-MM-dd"),
    plannedRetirementDate: dateYearsFrom(start, 10),
    annualSpending,
    annualNetEmploymentIncome: 48_000,
    delayedIncomeAnnual: 12_000,
    delayedIncomeStartDate: dateYearsFrom(start, 15),
    pensionAccessDate: dateYearsFrom(start, 10),
    taxableWithdrawalTaxRate: 0.1,
    pensionWithdrawalTaxRate: 0.2,
    retireEarlierYears: 2,
    workLongerYears: 2,
    lowerIncomeRate: 0.5,
    assumptionSets: [
      {
        id: "conservative",
        name: "Conservative",
        annualReturn: 0.02,
        annualInflation: 0.04,
        annualSpendingChange: 0.01,
        annualFeeRate: 0.01,
        longevityYears: 35,
        earlyReturnShock: -0.2,
        earlyReturnShockYears: 2,
      },
      {
        id: "central",
        name: "Central",
        annualReturn: 0.05,
        annualInflation: 0.025,
        annualSpendingChange: 0,
        annualFeeRate: 0.005,
        longevityYears: 35,
        earlyReturnShock: 0,
        earlyReturnShockYears: 0,
      },
      {
        id: "optimistic",
        name: "Optimistic",
        annualReturn: 0.07,
        annualInflation: 0.02,
        annualSpendingChange: -0.005,
        annualFeeRate: 0.003,
        longevityYears: 35,
        earlyReturnShock: 0,
        earlyReturnShockYears: 0,
      },
    ],
  };
}

function readStoredDraft(): RetirementStressDraft | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored == null) return null;
    const parsed = RetirementStressDraftSchema.safeParse(JSON.parse(stored));
    if (parsed.success) return parsed.data;
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    return null;
  }
  return null;
}

function writeStoredDraft(draft: RetirementStressDraft): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // The comparison remains usable in memory when storage is blocked or full.
  }
}

export function useStoredRetirementStressDraft(
  annualSpending: number,
): [RetirementStressDraft, Dispatch<SetStateAction<RetirementStressDraft>>] {
  const [draft, setDraft] = useState(() => initialDraft(annualSpending));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const stored = readStoredDraft();
    if (stored != null) setDraft(stored);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) writeStoredDraft(draft);
  }, [draft, loaded]);

  return [draft, setDraft];
}

function fallbackAccessPolicy(
  account: RetirementPlannerAccount,
  draft: RetirementStressDraft,
): AccountAccessPolicy {
  if (isLiability(account.assetType) || account.assetType === "property") {
    return {
      accessDelayMonths: 0,
      withdrawalFeeRate: 0,
      taxTreatment: {
        kind: "unsupported",
        reason: "This account cannot fund ordinary retirement spending",
      },
      canFundOrdinarySpending: false,
    };
  }
  if (account.taxWrapper === "pension") {
    return {
      accessibleFromDate: draft.pensionAccessDate,
      accessDelayMonths: 0,
      withdrawalFeeRate: 0,
      taxTreatment: {
        kind: "fixed-rate",
        rate: draft.pensionWithdrawalTaxRate,
      },
      canFundOrdinarySpending: true,
    };
  }
  if (account.taxWrapper === "isa" || account.assetType === "cash") {
    return {
      accessDelayMonths: 0,
      withdrawalFeeRate: 0,
      taxTreatment: { kind: "tax-free" },
      canFundOrdinarySpending: true,
    };
  }
  return {
    accessDelayMonths: 0,
    withdrawalFeeRate: 0,
    taxTreatment: {
      kind: "fixed-rate",
      rate: draft.taxableWithdrawalTaxRate,
    },
    canFundOrdinarySpending: true,
  };
}

function withdrawalPriority(account: RetirementCapitalAccount): number {
  if (account.assetType === "cash") return 0;
  if (account.taxWrapper === "taxable" || account.taxWrapper == null) return 1;
  if (account.taxWrapper === "isa") return 2;
  return 3;
}

export function buildRetirementProjectionFacts(
  draft: RetirementStressDraft,
  availableAccounts: readonly RetirementPlannerAccount[],
): RetirementProjectionFacts {
  const accounts = availableAccounts
    .filter(
      (account) =>
        account.isOpen &&
        account.latestBalance != null &&
        Number.isFinite(account.latestBalance),
    )
    .map(
      (account): RetirementCapitalAccount => ({
        id: account.id,
        name: account.name,
        provider: account.provider,
        assetType: account.assetType,
        liquidity: account.liquidity,
        taxWrapper: account.taxWrapper,
        accessPolicy:
          account.accessPolicy ?? fallbackAccessPolicy(account, draft),
        expectedAnnualReturn: account.expectedAnnualReturn,
        expectedReturnChanges: account.expectedReturnChanges,
        balance: account.latestBalance ?? 0,
      }),
    );
  const withdrawalOrder = accounts
    .filter(
      (account) =>
        !isLiability(account.assetType) && account.assetType !== "property",
    )
    .toSorted(
      (left, right) =>
        withdrawalPriority(left) - withdrawalPriority(right) ||
        left.name.localeCompare(right.name),
    )
    .map(({ id }) => id);
  return {
    startDate: draft.startDate,
    plannedRetirementDate: draft.plannedRetirementDate,
    annualSpending: draft.annualSpending,
    annualNetEmploymentIncome: draft.annualNetEmploymentIncome,
    delayedIncomeAnnual: draft.delayedIncomeAnnual,
    delayedIncomeStartDate: draft.delayedIncomeStartDate,
    accounts,
    withdrawalOrder,
  };
}

export function calculateRetirementStressComparison(input: {
  draft: RetirementStressDraft;
  accounts: readonly RetirementPlannerAccount[];
}): {
  comparison: RetirementProjectionRangeComparison | null;
  error: string | null;
} {
  try {
    return {
      comparison: compareRetirementProjectionRanges({
        facts: buildRetirementProjectionFacts(input.draft, input.accounts),
        assumptionSets: input.draft.assumptionSets,
        pathOptions: {
          retireEarlierYears: input.draft.retireEarlierYears,
          workLongerYears: input.draft.workLongerYears,
          lowerIncomeRate: input.draft.lowerIncomeRate,
        },
      }),
      error: null,
    };
  } catch (cause) {
    return {
      comparison: null,
      error:
        cause instanceof Error ? cause.message : "The assumptions are invalid",
    };
  }
}
