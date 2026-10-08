import { differenceInCalendarMonths, parseISO } from "date-fns";
import {
  accountLiquidity,
  effectiveExpectedReturn,
  isLiability,
} from "./account";
import type { AssetTrackerRepository } from "./assetTrackerRepository";
import type { Currency } from "./currency";
import type { EmergencyFundAnalysis } from "./emergencyFund";
import {
  type CashFlowDecision,
  futureCashFlowForecastItems,
} from "./futureCashFlow";
import {
  buildRunwayScenarioProjection,
  type RunwayScenarioPoint,
} from "./runwayForecast";

export type DecisionScenarioComparisonInput = {
  decisionIds: readonly string[];
  horizonMonths: number;
  reserveMonths: number | null;
  startDate: string;
  annualExpenditure: number | null;
  annualCurrentExpenditure: number | null;
  financialIndependenceTarget: number | null;
  emergencyFundAnalysis: EmergencyFundAnalysis | null;
};

export type DecisionScenarioMetrics = {
  cashBalance: number;
  liquidBalance: number;
  totalBalance: number;
  cashMonths: number;
  liquidMonths: number;
  totalMonths: number;
  reserveCoverageMonths: number | null;
  accountShortfalls: Array<{
    accountId: string;
    accountName: string;
    amount: number;
  }>;
};

export type DecisionScenarioPoint = {
  date: string;
  isMaterialDate: boolean;
  baseline: DecisionScenarioMetrics;
  lowCost: DecisionScenarioMetrics;
  expected: DecisionScenarioMetrics;
  highCost: DecisionScenarioMetrics;
  cumulativeEffect: {
    cash: number;
    liquid: number;
    total: number;
    cashMonths: number;
    liquidMonths: number;
    totalMonths: number;
  };
  marginalEffect: {
    cash: number;
    liquid: number;
    total: number;
    cashMonths: number;
    liquidMonths: number;
    totalMonths: number;
  };
  accountEffects: Array<{
    accountId: string;
    accountName: string;
    baselineBalance: number;
    expectedBalance: number;
    lowCostBalance: number;
    highCostBalance: number;
    cumulativeEffect: number;
    marginalEffect: number;
  }>;
};

export type DecisionScenarioAction = {
  id: string;
  date: string;
  cadence: "once" | "monthly";
  kind: "payment" | "saving" | "asset-sale";
  name: string;
  accountName: string;
  amount: number;
  currency: Currency;
  countsAsExpenditure: boolean;
};

export type DecisionFundingMechanic = {
  id: string;
  decisionName: string;
  stageName: string;
  accountName: string;
  fundingMethod: "cash" | "asset-sale";
  liquidity: ReturnType<typeof accountLiquidity>;
  annualReturn: number;
  accessDelayDays: number | null;
  currency: Currency;
  convertsToBaseCurrency: boolean;
  taxAndFees: string;
};

export type DecisionJudgment = {
  id: string;
  name: string;
  planningCaseId?: string;
  importance?: string;
  confidence?: number;
  reversibility: CashFlowDecision["reversibility"];
};

export type DecisionScenarioComparison = {
  requestedDecisionIds: string[];
  includedDecisionIds: string[];
  includedDependencyIds: string[];
  warnings: string[];
  materialDates: string[];
  timeline: DecisionScenarioPoint[];
  goalDates: {
    baseline: string | null;
    lowCost: string | null;
    expected: string | null;
    highCost: string | null;
  };
  actions: DecisionScenarioAction[];
  fundingMechanics: DecisionFundingMechanic[];
  judgments: DecisionJudgment[];
};

type DecisionPath = "lowCost" | "expected" | "highCost";

const DECISION_PATHS = {
  lowCost: { amount: "minimum", timing: "latest" },
  expected: { amount: "expected", timing: "expected" },
  highCost: { amount: "maximum", timing: "earliest" },
} as const;

function decisionsById(repository: AssetTrackerRepository) {
  return new Map(
    repository.futureCashFlows.flatMap((record) =>
      record.kind === "decision" ? [[record.id, record] as const] : [],
    ),
  );
}

function resolveDecisionIds(
  repository: AssetTrackerRepository,
  requestedIds: readonly string[],
): { includedIds: string[]; dependencyIds: string[]; warnings: string[] } {
  const byId = decisionsById(repository);
  const requested = new Set(requestedIds);
  const included = new Set<string>();
  const dependencies = new Set<string>();
  const warnings: string[] = [];
  const visiting = new Set<string>();

  function include(id: string, isDependency: boolean) {
    if (included.has(id)) return;
    const decision = byId.get(id);
    if (decision == null) {
      warnings.push(`Decision ${id} is unavailable and was not compared.`);
      return;
    }
    if (visiting.has(id)) {
      warnings.push(`Decision dependency cycle includes ${decision.name}.`);
      return;
    }
    visiting.add(id);
    for (const dependencyId of decision.dependencyIds) {
      if (byId.has(dependencyId)) include(dependencyId, true);
    }
    visiting.delete(id);
    included.add(id);
    if (isDependency && !requested.has(id)) dependencies.add(id);
  }

  for (const id of requestedIds) include(id, false);
  const selected = Array.from(included);
  for (const id of selected) {
    const decision = byId.get(id);
    if (decision == null) continue;
    const conflicting = decision.alternativeToIds
      .filter((alternativeId) => included.has(alternativeId))
      .map((alternativeId) => byId.get(alternativeId)?.name ?? alternativeId);
    if (conflicting.length > 0) {
      warnings.push(
        `${decision.name} is marked as an alternative to ${conflicting.join(", ")}.`,
      );
    }
  }
  return {
    includedIds: selected,
    dependencyIds: Array.from(dependencies),
    warnings: Array.from(new Set(warnings)),
  };
}

function projection(
  repository: AssetTrackerRepository,
  input: DecisionScenarioComparisonInput,
  decisionIds: readonly string[],
  path: DecisionPath,
) {
  return buildRunwayScenarioProjection({
    repository,
    annualExpenditure: input.annualExpenditure,
    annualCurrentExpenditure: input.annualCurrentExpenditure,
    startDate: input.startDate,
    months: input.horizonMonths,
    decisionSelection: {
      decisionIds,
      ...DECISION_PATHS[path],
    },
  });
}

function accessibleReserve(
  point: RunwayScenarioPoint,
  analysis: EmergencyFundAnalysis | null,
): number | null {
  if (analysis == null) return null;
  return analysis.sources.reduce((total, source) => {
    if (!source.included) return total;
    const balance = Math.max(point.accountBalances[source.accountId] ?? 0, 0);
    return (
      total +
      Math.max(
        balance * (1 - source.policy.capitalRiskRate) -
          source.policy.withdrawalFee,
        0,
      )
    );
  }, 0);
}

function metrics(
  repository: AssetTrackerRepository,
  point: RunwayScenarioPoint,
  emergencyFundAnalysis: EmergencyFundAnalysis | null,
): DecisionScenarioMetrics {
  const reserve = accessibleReserve(point, emergencyFundAnalysis);
  const monthlyNeed = emergencyFundAnalysis?.monthlyEssentialNeed ?? 0;
  return {
    cashBalance: point.cashBalance,
    liquidBalance: point.liquidBalance,
    totalBalance: point.totalBalance,
    cashMonths: point.cashMonths,
    liquidMonths: point.liquidMonths,
    totalMonths: point.totalMonths,
    reserveCoverageMonths:
      reserve == null || monthlyNeed <= 0 ? null : reserve / monthlyNeed,
    accountShortfalls: Object.entries(point.accountBalances).flatMap(
      ([accountId, balance]) => {
        const account = repository.accounts.get(accountId);
        if (account == null || isLiability(account.assetType) || balance >= 0) {
          return [];
        }
        return [
          {
            accountId,
            accountName: account.name,
            amount: Math.abs(balance),
          },
        ];
      },
    ),
  };
}

function goalDate(
  points: readonly RunwayScenarioPoint[],
  target: number | null,
): string | null {
  if (target == null || target <= 0) return null;
  return (
    points.find(({ totalBalance }) => totalBalance >= target)?.date ?? null
  );
}

function pointOnOrAfter(
  points: readonly RunwayScenarioPoint[],
  date: string,
): RunwayScenarioPoint | null {
  return points.find((point) => point.date >= date) ?? points.at(-1) ?? null;
}

function materialDates(
  repository: AssetTrackerRepository,
  decisionIds: readonly string[],
  points: readonly RunwayScenarioPoint[],
): string[] {
  const dates = futureCashFlowForecastItems(repository.futureCashFlows, {
    decisionIds,
    amount: "expected",
    timing: "expected",
  }).flatMap(({ date }) => {
    const point = pointOnOrAfter(points, date);
    return point == null ? [] : [point.date];
  });
  const horizonDate = points.at(-1)?.date;
  if (horizonDate != null) dates.push(horizonDate);
  return Array.from(new Set(dates)).toSorted((left, right) =>
    left.localeCompare(right),
  );
}

function actions(
  repository: AssetTrackerRepository,
  input: DecisionScenarioComparisonInput,
  decisionIds: readonly string[],
  baseline: readonly RunwayScenarioPoint[],
): DecisionScenarioAction[] {
  const decisionSet = new Set(decisionIds);
  const forecastItems = futureCashFlowForecastItems(
    repository.futureCashFlows,
    {
      decisionIds,
      amount: "expected",
      timing: "expected",
    },
  ).filter(({ kind, futureCashFlowId }) =>
    kind === "decision" ? decisionSet.has(futureCashFlowId) : false,
  );
  const scheduledByAccount = new Map<string, number>();
  const savingGapByAccount = new Map<string, number>();
  const result: DecisionScenarioAction[] = [];
  for (const item of forecastItems) {
    const account = repository.accounts.get(item.fromAccountId);
    if (account == null) continue;
    const method = account.assetType === "cash" ? "payment" : "asset-sale";
    const scheduled = (scheduledByAccount.get(account.id) ?? 0) + item.amount;
    scheduledByAccount.set(account.id, scheduled);
    const baselinePoint = pointOnOrAfter(baseline, item.date);
    const available = Math.max(
      baselinePoint?.accountBalances[item.fromAccountId] ?? 0,
      0,
    );
    const savingGap = Math.max(scheduled - available, 0);
    const previousSavingGap = savingGapByAccount.get(account.id) ?? 0;
    const additionalSaving = Math.max(savingGap - previousSavingGap, 0);
    savingGapByAccount.set(account.id, Math.max(previousSavingGap, savingGap));
    if (additionalSaving > 0) {
      const months = Math.max(
        differenceInCalendarMonths(
          parseISO(item.date),
          parseISO(input.startDate),
        ),
        1,
      );
      result.push({
        id: `${item.id}:saving`,
        date: input.startDate,
        cadence: "monthly",
        kind: "saving",
        name: `Save toward ${item.name}`,
        accountName: account.name,
        amount: additionalSaving / months,
        currency: item.currency,
        countsAsExpenditure: false,
      });
    }
    result.push({
      id: item.id,
      date: item.date,
      cadence: "once",
      kind: method,
      name: item.name,
      accountName: account.name,
      amount: item.amount,
      currency: item.currency,
      countsAsExpenditure: method === "payment",
    });
  }
  return result.toSorted(
    (left, right) =>
      left.date.localeCompare(right.date) || left.id.localeCompare(right.id),
  );
}

function fundingMechanics(
  repository: AssetTrackerRepository,
  input: DecisionScenarioComparisonInput,
  decisionIds: readonly string[],
): DecisionFundingMechanic[] {
  const selected = new Set(decisionIds);
  const accessPolicies = new Map(
    input.emergencyFundAnalysis?.sources.map((source) => [
      source.accountId,
      source.policy,
    ]) ?? [],
  );
  return repository.futureCashFlows.flatMap((record) => {
    if (record.kind !== "decision" || !selected.has(record.id)) return [];
    return record.stages.flatMap((stage) => {
      const account = repository.accounts.get(stage.fromAccountId);
      if (account == null) return [];
      return [
        {
          id: `${record.id}:${stage.id}`,
          decisionName: record.name,
          stageName: stage.name ?? "Payment",
          accountName: account.name,
          fundingMethod: account.assetType === "cash" ? "cash" : "asset-sale",
          liquidity: accountLiquidity(account),
          annualReturn: effectiveExpectedReturn(account, stage.expectedDate),
          accessDelayDays:
            accessPolicies.get(account.id)?.accessDelayDays ?? null,
          currency: record.currency,
          convertsToBaseCurrency:
            record.currency !== repository.settings.baseCurrency,
          taxAndFees:
            record.notes ??
            "The entered amount includes any tax and fees. No separate estimate is applied.",
        },
      ];
    });
  });
}

export function compareDecisionScenarios(
  repository: AssetTrackerRepository,
  input: DecisionScenarioComparisonInput,
): DecisionScenarioComparison {
  const resolved = resolveDecisionIds(repository, input.decisionIds);
  const baseline = projection(repository, input, [], "expected");
  const lowCost = projection(
    repository,
    input,
    resolved.includedIds,
    "lowCost",
  );
  const expected = projection(
    repository,
    input,
    resolved.includedIds,
    "expected",
  );
  const highCost = projection(
    repository,
    input,
    resolved.includedIds,
    "highCost",
  );
  const dates = materialDates(repository, resolved.includedIds, expected);
  const material = new Set(dates);
  let previousEffect = {
    cash: 0,
    liquid: 0,
    total: 0,
    cashMonths: 0,
    liquidMonths: 0,
    totalMonths: 0,
  };
  const previousAccountEffects = new Map<string, number>();
  const timeline = expected.flatMap((expectedPoint, index) => {
    const baselinePoint = baseline[index];
    const lowCostPoint = lowCost[index];
    const highCostPoint = highCost[index];
    if (
      baselinePoint == null ||
      lowCostPoint == null ||
      highCostPoint == null
    ) {
      return [];
    }
    const cumulativeEffect = {
      cash: expectedPoint.cashBalance - baselinePoint.cashBalance,
      liquid: expectedPoint.liquidBalance - baselinePoint.liquidBalance,
      total: expectedPoint.totalBalance - baselinePoint.totalBalance,
      cashMonths: expectedPoint.cashMonths - baselinePoint.cashMonths,
      liquidMonths: expectedPoint.liquidMonths - baselinePoint.liquidMonths,
      totalMonths: expectedPoint.totalMonths - baselinePoint.totalMonths,
    };
    const marginalEffect = {
      cash: cumulativeEffect.cash - previousEffect.cash,
      liquid: cumulativeEffect.liquid - previousEffect.liquid,
      total: cumulativeEffect.total - previousEffect.total,
      cashMonths: cumulativeEffect.cashMonths - previousEffect.cashMonths,
      liquidMonths: cumulativeEffect.liquidMonths - previousEffect.liquidMonths,
      totalMonths: cumulativeEffect.totalMonths - previousEffect.totalMonths,
    };
    previousEffect = cumulativeEffect;
    const accountEffects = Array.from(repository.accounts.values()).map(
      (account) => {
        const baselineBalance = baselinePoint.accountBalances[account.id] ?? 0;
        const expectedBalance = expectedPoint.accountBalances[account.id] ?? 0;
        const cumulativeAccountEffect = expectedBalance - baselineBalance;
        const marginalAccountEffect =
          cumulativeAccountEffect -
          (previousAccountEffects.get(account.id) ?? 0);
        previousAccountEffects.set(account.id, cumulativeAccountEffect);
        return {
          accountId: account.id,
          accountName: account.name,
          baselineBalance,
          expectedBalance,
          lowCostBalance: lowCostPoint.accountBalances[account.id] ?? 0,
          highCostBalance: highCostPoint.accountBalances[account.id] ?? 0,
          cumulativeEffect: cumulativeAccountEffect,
          marginalEffect: marginalAccountEffect,
        };
      },
    );
    return [
      {
        date: expectedPoint.date,
        isMaterialDate: material.has(expectedPoint.date),
        baseline: metrics(
          repository,
          baselinePoint,
          input.emergencyFundAnalysis,
        ),
        lowCost: metrics(repository, lowCostPoint, input.emergencyFundAnalysis),
        expected: metrics(
          repository,
          expectedPoint,
          input.emergencyFundAnalysis,
        ),
        highCost: metrics(
          repository,
          highCostPoint,
          input.emergencyFundAnalysis,
        ),
        cumulativeEffect,
        marginalEffect,
        accountEffects,
      },
    ];
  });
  const byId = decisionsById(repository);
  return {
    requestedDecisionIds: [...input.decisionIds],
    includedDecisionIds: resolved.includedIds,
    includedDependencyIds: resolved.dependencyIds,
    warnings: resolved.warnings,
    materialDates: dates,
    timeline,
    goalDates: {
      baseline: goalDate(baseline, input.financialIndependenceTarget),
      lowCost: goalDate(lowCost, input.financialIndependenceTarget),
      expected: goalDate(expected, input.financialIndependenceTarget),
      highCost: goalDate(highCost, input.financialIndependenceTarget),
    },
    actions: actions(repository, input, resolved.includedIds, baseline),
    fundingMechanics: fundingMechanics(repository, input, resolved.includedIds),
    judgments: resolved.includedIds.flatMap((id) => {
      const decision = byId.get(id);
      if (decision == null) return [];
      return [
        {
          id,
          name: decision.name,
          planningCaseId: decision.planningCaseId,
          importance: decision.importance,
          confidence: decision.confidence,
          reversibility: decision.reversibility,
        },
      ];
    }),
  };
}
