"use client";

import type { InflationDatasetRelease } from "finance-inflation-indices";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import {
  type AccountDetailView,
  type GrowthCashFlow,
  type GrowthScenario,
  projectCompoundGrowth,
} from "@/app/_projects/personal-finance-app/domain";

const STORAGE_KEY = "assettracker:compound-growth-planner:v1";

export type PlannerDraft = Omit<
  GrowthScenario,
  "linkedAccounts" | "cashFlows"
> & {
  selectedAccountIds: string[];
  recurringFlow: GrowthCashFlow;
  oneOffFlow: GrowthCashFlow;
};

export type GrowthPlannerAccount = Pick<
  AccountDetailView,
  "id" | "name" | "latestBalance" | "taxWrapper"
>;

export type GrowthProjections = ReturnType<typeof projectCompoundGrowth>;

function initialDraft(): PlannerDraft {
  const startDate = `${new Date().toISOString().slice(0, 7)}-01`;
  return {
    id: "compound-growth-default",
    name: "Long-term growth plan",
    startDate,
    horizonMonths: 120,
    principal: 10_000,
    selectedAccountIds: [],
    recurringFlow: {
      id: "recurring",
      label: "Regular saving",
      kind: "contribution",
      amount: 500,
      startDate,
      frequency: "monthly",
      source: "manual",
    },
    oneOffFlow: {
      id: "one-off",
      label: "One-off cash flow",
      kind: "withdrawal",
      amount: 0,
      startDate,
      frequency: "once",
      source: "manual",
    },
    contributionTiming: "end",
    annualReturn: 0.05,
    returnConvention: { kind: "effective-annual" },
    returnType: "uncertain-investment",
    annualFeeRate: 0.0025,
    wrapper: "isa",
    taxableGrowthTaxRate: 0.2,
    futureInflationRate: 0.025,
    stressReturnDelta: 0.03,
    stressInflationDelta: 0.015,
  };
}

export function useStoredGrowthDraft(): [
  PlannerDraft,
  Dispatch<SetStateAction<PlannerDraft>>,
] {
  const [draft, setDraft] = useState<PlannerDraft>(initialDraft);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored != null) {
      try {
        setDraft({
          ...initialDraft(),
          ...(JSON.parse(stored) as PlannerDraft),
        });
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  }, [draft, loaded]);

  return [draft, setDraft];
}

export function buildGrowthScenario(
  draft: PlannerDraft,
  availableAccounts: readonly GrowthPlannerAccount[],
): GrowthScenario {
  const linkedAccounts = availableAccounts
    .filter((account) => draft.selectedAccountIds.includes(account.id))
    .map((account) => ({
      id: account.id,
      name: account.name,
      balance: account.latestBalance ?? 0,
      taxWrapper: account.taxWrapper,
    }));
  const {
    selectedAccountIds: _selectedAccountIds,
    recurringFlow,
    oneOffFlow,
    ...assumptions
  } = draft;
  return {
    ...assumptions,
    linkedAccounts,
    cashFlows: [recurringFlow, oneOffFlow].filter(({ amount }) => amount > 0),
  };
}

export function calculateGrowthProjections(scenario: GrowthScenario): {
  error: string | null;
  projections: GrowthProjections;
} {
  try {
    return { error: null, projections: projectCompoundGrowth(scenario) };
  } catch (cause) {
    return {
      error:
        cause instanceof Error ? cause.message : "The assumptions are invalid",
      projections: [],
    };
  }
}

function inflationLineage(release: InflationDatasetRelease | null) {
  return release == null
    ? null
    : {
        index: release.index,
        versionId: release.versionId,
        releaseVersion: release.source.releaseVersion,
        coverageThrough: release.source.coverageThrough,
        sourceUrl: release.source.sourceUrl,
      };
}

export function downloadGrowthCalculation(input: {
  draftId: string;
  inflationRelease: InflationDatasetRelease | null;
  projections: GrowthProjections;
  scenario: GrowthScenario;
}): void {
  const content = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      scenario: input.scenario,
      projections: input.projections,
      historicalInflationDataset: inflationLineage(input.inflationRelease),
    },
    null,
    2,
  );
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `compound-growth-${input.draftId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
