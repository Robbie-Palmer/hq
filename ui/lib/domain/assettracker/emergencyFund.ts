import { addMonths, format, parseISO } from "date-fns";
import { z } from "zod";
import {
  type Account,
  AccountIdSchema,
  accountLiquidity,
  isLiability,
} from "./account";
import type { AssetTrackerRepository } from "./assetTrackerRepository";
import { futureCashFlowForecastItems } from "./futureCashFlow";
import {
  convertAccountAmountAtDate,
  latestValuedBalances,
} from "./portfolioValuation";

const OptionalTextSchema = z.string().trim().min(1).optional();

export const EmergencyFundAccountPolicySchema = z
  .object({
    accountId: AccountIdSchema,
    included: z.boolean(),
    kind: z.enum(["cash", "cash-equivalent"]),
    accessDelayDays: z.number().int().nonnegative(),
    capitalRiskRate: z.number().min(0).max(1),
    withdrawalFee: z.number().nonnegative(),
    protectionLimit: z.number().nonnegative().optional(),
    protectionGroup: OptionalTextSchema,
    protectionSourceUrl: z.url().optional(),
    notes: OptionalTextSchema,
  })
  .superRefine((policy, context) => {
    if (policy.protectionLimit != null && policy.protectionSourceUrl == null) {
      context.addIssue({
        code: "custom",
        message: "A protection limit needs a source URL",
        path: ["protectionSourceUrl"],
      });
    }
  });
export type EmergencyFundAccountPolicy = z.infer<
  typeof EmergencyFundAccountPolicySchema
>;

export const EmergencyFundStressScenarioSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  durationMonths: z.number().int().positive().max(120),
  employmentIncomeLossRate: z.number().min(0).max(1),
  sideIncomeDelayMonths: z.number().int().nonnegative().max(120),
  unexpectedCost: z.number().nonnegative(),
  annualInflationRate: z.number().gt(-1),
});
export type EmergencyFundStressScenario = z.infer<
  typeof EmergencyFundStressScenarioSchema
>;

export const EmergencyFundPlanInputSchema = z.object({
  name: z.string().trim().min(1, "Give the reserve plan a name"),
  essentialMonthlyExpenditure: z.number().nonnegative(),
  annualIrregularEssentialCosts: z.number().nonnegative(),
  monthlyDebtPayments: z.number().nonnegative(),
  dependantCount: z.number().int().nonnegative(),
  employmentMonthlyIncome: z.number().nonnegative(),
  employmentIncomeReliability: z.number().min(0).max(1),
  monthlySideIncome: z.number().nonnegative(),
  sideIncomeReliability: z.number().min(0).max(1),
  accessNeedDays: z.number().int().nonnegative(),
  missingData: z
    .array(z.string().trim().min(1))
    .default([])
    .transform((values) => Array.from(new Set(values))),
  coverageMonths: z
    .array(z.number().positive().max(120))
    .min(2, "Compare at least two reserve policies")
    .transform((values) =>
      Array.from(new Set(values)).toSorted((a, b) => a - b),
    ),
  accountPolicies: z
    .array(EmergencyFundAccountPolicySchema)
    .superRefine((policies, context) => {
      const seen = new Set<string>();
      for (const policy of policies) {
        if (seen.has(policy.accountId)) {
          context.addIssue({
            code: "custom",
            message: `Account ${policy.accountId} is included more than once`,
          });
        }
        seen.add(policy.accountId);
      }
    }),
  stressScenarios: z.array(EmergencyFundStressScenarioSchema).min(1),
});
export type EmergencyFundPlanInput = z.infer<
  typeof EmergencyFundPlanInputSchema
>;

export const EmergencyFundPlanSchema = EmergencyFundPlanInputSchema.extend({
  id: z.string().trim().min(1),
  seriesId: z.string().trim().min(1),
  version: z.number().int().positive(),
  status: z.enum(["active", "superseded"]),
  createdAt: z.iso.datetime({ offset: true }),
  supersedesId: z.string().trim().min(1).optional(),
});
export type EmergencyFundPlan = z.infer<typeof EmergencyFundPlanSchema>;

export type EmergencyFundSource = {
  accountId: string;
  accountName: string;
  included: boolean;
  exclusionReason: string | null;
  balance: number;
  effectiveBalance: number;
  protectedBalance: number | null;
  policy: EmergencyFundAccountPolicy;
};

export type EmergencyFundPathPoint = {
  month: number;
  date: string;
  reserveBalance: number;
  monthlyNeed: number;
  availableIncome: number;
  decisionCosts: number;
  uncoveredShortfall: number;
};

export type EmergencyFundStressResult = {
  scenarioId: string;
  scenarioName: string;
  policyMonths: number | null;
  startingReserve: number;
  endingReserve: number;
  firstShortfallMonth: number | null;
  shortfallMonths: number;
  totalShortfall: number;
  maximumMonthlyShortfall: number;
  path: EmergencyFundPathPoint[];
};

export type EmergencyFundAnalysis = {
  monthlyEssentialNeed: number;
  accessibleFunds: number;
  accessibleCoverageMonths: number | null;
  sources: EmergencyFundSource[];
  selectedDecisionCosts: number;
  policyTargets: Array<{
    months: number;
    target: number;
    fundingGap: number;
    availableAboveTarget: number;
  }>;
  currentResults: EmergencyFundStressResult[];
  policyResults: EmergencyFundStressResult[];
};

type ReserveAccount = Pick<
  Account,
  | "id"
  | "name"
  | "provider"
  | "assetType"
  | "liquidity"
  | "taxWrapper"
  | "closedAt"
>;

function defaultIncluded(account: ReserveAccount): boolean {
  if (account.closedAt != null || isLiability(account.assetType)) return false;
  if (account.taxWrapper === "pension") return false;
  if (accountLiquidity(account) === "illiquid") return false;
  if (account.assetType !== "cash" && account.assetType !== "bonds") {
    return false;
  }
  return !/\b(business|tax reserve|vat|hmrc)\b/i.test(
    `${account.name} ${account.provider}`,
  );
}

export function defaultEmergencyFundAccountPolicy(
  account: ReserveAccount,
): EmergencyFundAccountPolicy {
  const liquidity = accountLiquidity(account);
  return {
    accountId: account.id,
    included: defaultIncluded(account),
    kind: liquidity === "cash" ? "cash" : "cash-equivalent",
    accessDelayDays: liquidity === "cash" ? 0 : 3,
    capitalRiskRate: liquidity === "cash" ? 0 : 0.1,
    withdrawalFee: 0,
    protectionGroup: account.provider,
  };
}

export function defaultEmergencyFundPlanInput(
  repository: AssetTrackerRepository,
  annualCurrentExpenditure: number | null,
): EmergencyFundPlanInput {
  const monthlyExpenditure = Math.max((annualCurrentExpenditure ?? 0) / 12, 0);
  return {
    name: "Household emergency reserves",
    essentialMonthlyExpenditure: Math.round(monthlyExpenditure),
    annualIrregularEssentialCosts: 0,
    monthlyDebtPayments: 0,
    dependantCount: 0,
    employmentMonthlyIncome: Math.round(monthlyExpenditure),
    employmentIncomeReliability: 0.8,
    monthlySideIncome: 0,
    sideIncomeReliability: 0.5,
    accessNeedDays: 7,
    missingData:
      annualCurrentExpenditure == null
        ? ["Reconciled essential household expenditure"]
        : ["Irregular essential costs", "Income stability review"],
    coverageMonths: [3, 6, 9],
    accountPolicies: Array.from(repository.accounts.values()).map(
      defaultEmergencyFundAccountPolicy,
    ),
    stressScenarios: [
      {
        id: "income-and-cost-shock",
        name: "Income loss and unexpected cost",
        durationMonths: 12,
        employmentIncomeLossRate: 1,
        sideIncomeDelayMonths: 2,
        unexpectedCost: Math.round(monthlyExpenditure),
        annualInflationRate: repository.settings.expectedAnnualInflation,
      },
    ],
  };
}

function exclusionReason(
  account: ReserveAccount,
  policy: EmergencyFundAccountPolicy,
  accessNeedDays: number,
): string | null {
  if (!policy.included) return "Excluded by this reserve policy";
  if (account.taxWrapper === "pension") return "Pension access is restricted";
  if (account.assetType === "property") return "Home equity is not cash";
  if (isLiability(account.assetType)) return "Liabilities are not reserves";
  if (accountLiquidity(account) === "illiquid")
    return "Account is marked illiquid";
  if (policy.accessDelayDays > accessNeedDays) {
    return `Access takes ${policy.accessDelayDays} days`;
  }
  return null;
}

function protectionByAccount(
  policies: readonly EmergencyFundAccountPolicy[],
  balances: ReadonlyMap<string, number>,
): Map<string, number | null> {
  const protectedByAccount = new Map<string, number | null>();
  const remainingByGroup = new Map<string, number>();
  for (const policy of policies) {
    if (policy.protectionLimit == null) {
      protectedByAccount.set(policy.accountId, null);
      continue;
    }
    const group = policy.protectionGroup ?? policy.accountId;
    const remaining = remainingByGroup.get(group) ?? policy.protectionLimit;
    const protectedAmount = Math.min(
      Math.max(balances.get(policy.accountId) ?? 0, 0),
      remaining,
    );
    protectedByAccount.set(policy.accountId, protectedAmount);
    remainingByGroup.set(group, Math.max(remaining - protectedAmount, 0));
  }
  return protectedByAccount;
}

function selectedDecisionCostsByMonth(
  repository: AssetTrackerRepository,
  startDate: string,
  durationMonths: number,
): Map<number, number> {
  const costs = new Map<number, number>();
  const start = parseISO(startDate);
  for (const item of futureCashFlowForecastItems(repository.futureCashFlows)) {
    if (item.kind !== "decision") continue;
    for (let month = 1; month <= durationMonths; month++) {
      const through = format(addMonths(start, month), "yyyy-MM-dd");
      const after = format(addMonths(start, month - 1), "yyyy-MM-dd");
      if (item.date <= after || item.date > through) continue;
      const amount =
        convertAccountAmountAtDate(
          repository,
          item.fromAccountId,
          item.amount,
          item.date,
        ) ?? 0;
      costs.set(month, (costs.get(month) ?? 0) + amount);
      break;
    }
  }
  return costs;
}

function simulateStress(input: {
  plan: EmergencyFundPlanInput;
  scenario: EmergencyFundStressScenario;
  startingReserve: number;
  policyMonths: number | null;
  monthlyEssentialNeed: number;
  decisionCosts: ReadonlyMap<number, number>;
  startDate: string;
}): EmergencyFundStressResult {
  const { plan, scenario } = input;
  const path: EmergencyFundPathPoint[] = [];
  let reserve = input.startingReserve;
  let firstShortfallMonth: number | null = null;
  let shortfallMonths = 0;
  let totalShortfall = 0;
  let maximumMonthlyShortfall = 0;
  for (let month = 1; month <= scenario.durationMonths; month++) {
    const monthlyNeed =
      input.monthlyEssentialNeed *
      (1 + scenario.annualInflationRate) ** (month / 12);
    const employmentIncome =
      plan.employmentMonthlyIncome *
      (1 - scenario.employmentIncomeLossRate) *
      plan.employmentIncomeReliability;
    const sideIncome =
      month <= scenario.sideIncomeDelayMonths
        ? 0
        : plan.monthlySideIncome * plan.sideIncomeReliability;
    const availableIncome = employmentIncome + sideIncome;
    const decisionCosts = input.decisionCosts.get(month) ?? 0;
    const unexpectedCost = month === 1 ? scenario.unexpectedCost : 0;
    const draw = Math.max(
      monthlyNeed + decisionCosts + unexpectedCost - availableIncome,
      0,
    );
    const uncoveredShortfall = Math.max(draw - reserve, 0);
    reserve = Math.max(reserve - draw, 0);
    if (uncoveredShortfall > 0) {
      firstShortfallMonth ??= month;
      shortfallMonths += 1;
      totalShortfall += uncoveredShortfall;
      maximumMonthlyShortfall = Math.max(
        maximumMonthlyShortfall,
        uncoveredShortfall,
      );
    }
    path.push({
      month,
      date: format(addMonths(parseISO(input.startDate), month), "yyyy-MM-dd"),
      reserveBalance: reserve,
      monthlyNeed,
      availableIncome,
      decisionCosts,
      uncoveredShortfall,
    });
  }
  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    policyMonths: input.policyMonths,
    startingReserve: input.startingReserve,
    endingReserve: reserve,
    firstShortfallMonth,
    shortfallMonths,
    totalShortfall,
    maximumMonthlyShortfall,
    path,
  };
}

export function analyseEmergencyFund(
  repository: AssetTrackerRepository,
  rawPlan: EmergencyFundPlanInput,
  startDate: string,
): EmergencyFundAnalysis {
  const plan = EmergencyFundPlanInputSchema.parse(rawPlan);
  const balances =
    latestValuedBalances(repository) ?? new Map<string, number>();
  const protectedBalances = protectionByAccount(plan.accountPolicies, balances);
  const policyByAccount = new Map(
    plan.accountPolicies.map((policy) => [policy.accountId, policy]),
  );
  const sources = Array.from(repository.accounts.values()).map((account) => {
    const policy =
      policyByAccount.get(account.id) ??
      defaultEmergencyFundAccountPolicy(account);
    const balance = Math.max(balances.get(account.id) ?? 0, 0);
    const reason = exclusionReason(account, policy, plan.accessNeedDays);
    return {
      accountId: account.id,
      accountName: account.name,
      included: reason == null,
      exclusionReason: reason,
      balance,
      effectiveBalance:
        reason == null
          ? Math.max(
              balance * (1 - policy.capitalRiskRate) - policy.withdrawalFee,
              0,
            )
          : 0,
      protectedBalance: protectedBalances.get(account.id) ?? null,
      policy,
    } satisfies EmergencyFundSource;
  });
  const monthlyEssentialNeed =
    plan.essentialMonthlyExpenditure +
    plan.annualIrregularEssentialCosts / 12 +
    plan.monthlyDebtPayments;
  const accessibleFunds = sources.reduce(
    (total, source) => total + source.effectiveBalance,
    0,
  );
  const accessibleCoverageMonths =
    monthlyEssentialNeed > 0 ? accessibleFunds / monthlyEssentialNeed : null;
  const maxDuration = Math.max(
    ...plan.stressScenarios.map(({ durationMonths }) => durationMonths),
  );
  const decisionCosts = selectedDecisionCostsByMonth(
    repository,
    startDate,
    maxDuration,
  );
  const policyTargets = plan.coverageMonths.map((months) => {
    const target = monthlyEssentialNeed * months;
    return {
      months,
      target,
      fundingGap: Math.max(target - accessibleFunds, 0),
      availableAboveTarget: Math.max(accessibleFunds - target, 0),
    };
  });
  return {
    monthlyEssentialNeed,
    accessibleFunds,
    accessibleCoverageMonths,
    sources,
    selectedDecisionCosts: Array.from(decisionCosts.values()).reduce(
      (total, amount) => total + amount,
      0,
    ),
    policyTargets,
    currentResults: plan.stressScenarios.map((scenario) =>
      simulateStress({
        plan,
        scenario,
        startingReserve: accessibleFunds,
        policyMonths: null,
        monthlyEssentialNeed,
        decisionCosts,
        startDate,
      }),
    ),
    policyResults: policyTargets.flatMap(({ months, target }) =>
      plan.stressScenarios.map((scenario) =>
        simulateStress({
          plan,
          scenario,
          startingReserve: target,
          policyMonths: months,
          monthlyEssentialNeed,
          decisionCosts,
          startDate,
        }),
      ),
    ),
  };
}
