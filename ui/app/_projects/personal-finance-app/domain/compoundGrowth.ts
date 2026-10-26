import { addMonths, format, parseISO } from "date-fns";
import type { TaxWrapper } from "./account";

export const COMPOUND_GROWTH_CALCULATION_VERSION = "2026.10.0";

export type ReturnConvention =
  | { kind: "effective-annual" }
  | { kind: "nominal-annual"; compoundingPeriods: number };

export type GrowthCashFlow = {
  id: string;
  label: string;
  kind: "contribution" | "withdrawal";
  amount: number;
  startDate: string;
  frequency: "once" | "monthly" | "quarterly" | "yearly";
  endDate?: string;
  source?:
    | "manual"
    | "internal-transfer"
    | "employee-pension"
    | "employer-pension";
  /** The same real-world flow can appear in several household records. Count it once. */
  dedupeKey?: string;
};

export type LinkedGrowthAccount = {
  id: string;
  name: string;
  balance: number;
  taxWrapper?: TaxWrapper;
};

export type GrowthScenario = {
  id: string;
  name: string;
  startDate: string;
  horizonMonths: number;
  principal: number;
  linkedAccounts: LinkedGrowthAccount[];
  cashFlows: GrowthCashFlow[];
  contributionTiming: "beginning" | "end";
  annualReturn: number;
  returnConvention: ReturnConvention;
  returnType: "guaranteed-savings" | "uncertain-investment";
  annualFeeRate: number;
  wrapper: TaxWrapper;
  taxableGrowthTaxRate: number;
  futureInflationRate: number;
  stressReturnDelta: number;
  stressInflationDelta: number;
};

export type GrowthProjectionPoint = {
  date: string;
  contributions: number;
  withdrawals: number;
  growth: number;
  fees: number;
  taxes: number;
  nominalBalance: number;
  purchasingPower: number;
};

export type GrowthLimitIssue = {
  taxYear: string;
  wrapper: "isa" | "pension";
  contributions: number;
  limit: number;
  excess: number;
  sourceUrl: string;
};

export type GrowthProjection = {
  scenario: "expected" | "downside" | "upside";
  annualReturn: number;
  futureInflationRate: number;
  points: GrowthProjectionPoint[];
  limitIssues: GrowthLimitIssue[];
  contributionRule: (WrapperRule & { wrapper: "isa" | "pension" }) | null;
  unsupportedCases: string[];
  lineage: string[];
};

type WrapperRule = {
  limit: number;
  sourceUrl: string;
};

const WRAPPER_RULES: Record<"isa" | "pension", WrapperRule> = {
  isa: {
    limit: 20_000,
    sourceUrl: "https://www.gov.uk/individual-savings-accounts/how-isas-work",
  },
  pension: {
    limit: 60_000,
    sourceUrl:
      "https://www.gov.uk/tax-on-your-private-pension/annual-allowance",
  },
};

const roundMoney = (amount: number): number =>
  Math.round((amount + Number.EPSILON) * 100) / 100;

export function equivalentEffectiveAnnualRate(
  annualRate: number,
  convention: ReturnConvention,
): number {
  if (annualRate <= -1)
    throw new RangeError("Annual return must be above -100%");
  if (convention.kind === "effective-annual") return annualRate;
  if (
    !Number.isInteger(convention.compoundingPeriods) ||
    convention.compoundingPeriods < 1
  ) {
    throw new RangeError("Compounding periods must be a positive integer");
  }
  return (
    (1 + annualRate / convention.compoundingPeriods) **
      convention.compoundingPeriods -
    1
  );
}

function monthlyRate(annualRate: number, convention: ReturnConvention): number {
  return (
    (1 + equivalentEffectiveAnnualRate(annualRate, convention)) ** (1 / 12) - 1
  );
}

function frequencyMonths(
  frequency: GrowthCashFlow["frequency"],
): number | null {
  if (frequency === "monthly") return 1;
  if (frequency === "quarterly") return 3;
  if (frequency === "yearly") return 12;
  return null;
}

function occursInMonth(flow: GrowthCashFlow, date: string): boolean {
  if (flow.startDate.slice(0, 7) > date.slice(0, 7)) return false;
  if (flow.endDate != null && flow.endDate.slice(0, 7) < date.slice(0, 7))
    return false;
  const period = frequencyMonths(flow.frequency);
  if (period == null) return flow.startDate.slice(0, 7) === date.slice(0, 7);
  const startYear = Number(flow.startDate.slice(0, 4));
  const startMonth = Number(flow.startDate.slice(5, 7));
  const currentYear = Number(date.slice(0, 4));
  const currentMonth = Number(date.slice(5, 7));
  const monthDifference =
    (currentYear - startYear) * 12 + currentMonth - startMonth;
  return monthDifference >= 0 && monthDifference % period === 0;
}

function uniqueCashFlows(
  cashFlows: readonly GrowthCashFlow[],
): GrowthCashFlow[] {
  const seen = new Set<string>();
  return cashFlows.filter((flow) => {
    if (flow.dedupeKey == null) return true;
    if (seen.has(flow.dedupeKey)) return false;
    seen.add(flow.dedupeKey);
    return true;
  });
}

function taxYear(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const startsThisYear = month > 4 || (month === 4 && day >= 6);
  const start = startsThisYear ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

function contributionLimitIssues(
  wrapper: TaxWrapper,
  appliedContributions: readonly { date: string; amount: number }[],
): GrowthLimitIssue[] {
  if (wrapper === "taxable") return [];
  const rule = WRAPPER_RULES[wrapper];
  const totals = new Map<string, number>();
  for (const contribution of appliedContributions) {
    const year = taxYear(contribution.date);
    totals.set(year, (totals.get(year) ?? 0) + contribution.amount);
  }
  return Array.from(totals, ([year, contributions]) => ({
    taxYear: year,
    wrapper,
    contributions: roundMoney(contributions),
    limit: rule.limit,
    excess: roundMoney(Math.max(contributions - rule.limit, 0)),
    sourceUrl: rule.sourceUrl,
  })).filter(({ excess }) => excess > 0);
}

function unsupportedCases(scenario: GrowthScenario): string[] {
  const cases: string[] = [];
  if (scenario.wrapper === "pension") {
    cases.push(
      "Pension tax relief, tapered annual allowance, carry-forward, and withdrawal tax are not modelled.",
    );
  }
  if (scenario.wrapper === "taxable") {
    cases.push(
      "Taxable growth uses the entered flat tax rate. Dividend, interest, and capital-gains allowances are not modelled.",
    );
  }
  const linkedWrappers = new Set(
    scenario.linkedAccounts.map(({ taxWrapper }) => taxWrapper).filter(Boolean),
  );
  if (
    linkedWrappers.size > 1 ||
    (linkedWrappers.size === 1 && !linkedWrappers.has(scenario.wrapper))
  ) {
    cases.push(
      "Linked accounts use different tax wrappers. Their opening balances are combined, but future flows use the selected scenario wrapper.",
    );
  }
  return cases;
}

function validateScenario(
  scenario: GrowthScenario,
  futureInflationRate: number,
): void {
  if (scenario.horizonMonths < 1 || !Number.isInteger(scenario.horizonMonths)) {
    throw new RangeError("Horizon must be a positive whole number of months");
  }
  if (scenario.annualFeeRate < 0 || scenario.taxableGrowthTaxRate < 0) {
    throw new RangeError("Fee and tax rates cannot be negative");
  }
  if (futureInflationRate <= -1) {
    throw new RangeError("Inflation must be above -100%");
  }
}

function simulate(
  scenario: GrowthScenario,
  projectionName: GrowthProjection["scenario"],
  annualReturn: number,
  futureInflationRate: number,
): GrowthProjection {
  validateScenario(scenario, futureInflationRate);

  const flows = uniqueCashFlows(scenario.cashFlows);
  const monthlyGrowthRate = monthlyRate(
    annualReturn,
    scenario.returnConvention,
  );
  const monthlyFeeRate = (1 + scenario.annualFeeRate) ** (1 / 12) - 1;
  const monthlyInflationRate = (1 + futureInflationRate) ** (1 / 12) - 1;
  const openingBalance =
    scenario.principal +
    scenario.linkedAccounts.reduce((sum, account) => sum + account.balance, 0);
  let balance = openingBalance;
  let inflationFactor = 1;
  let cumulativeContributions = 0;
  let cumulativeWithdrawals = 0;
  let cumulativeGrowth = 0;
  let cumulativeFees = 0;
  let cumulativeTaxes = 0;
  const appliedContributions: Array<{ date: string; amount: number }> = [];
  const points: GrowthProjectionPoint[] = [
    {
      date: scenario.startDate,
      contributions: 0,
      withdrawals: 0,
      growth: 0,
      fees: 0,
      taxes: 0,
      nominalBalance: roundMoney(balance),
      purchasingPower: roundMoney(balance),
    },
  ];

  for (let month = 0; month < scenario.horizonMonths; month++) {
    const date = format(
      addMonths(parseISO(scenario.startDate), month),
      "yyyy-MM-dd",
    );
    const currentFlows = flows.filter((flow) => occursInMonth(flow, date));
    const contributions = currentFlows
      .filter(({ kind }) => kind === "contribution")
      .reduce((sum, flow) => sum + flow.amount, 0);
    const withdrawals = currentFlows
      .filter(({ kind }) => kind === "withdrawal")
      .reduce((sum, flow) => sum + flow.amount, 0);
    for (const flow of currentFlows) {
      if (flow.kind === "contribution") {
        appliedContributions.push({ date, amount: flow.amount });
      }
    }

    if (scenario.contributionTiming === "beginning") {
      balance = Math.max(balance + contributions - withdrawals, 0);
    }
    const growth = balance * monthlyGrowthRate;
    const fees = Math.max(balance + growth, 0) * monthlyFeeRate;
    const taxes =
      scenario.wrapper === "taxable"
        ? Math.max(growth - fees, 0) * scenario.taxableGrowthTaxRate
        : 0;
    balance += growth - fees - taxes;
    if (scenario.contributionTiming === "end") {
      balance += contributions - withdrawals;
    }
    balance = Math.max(balance, 0);
    inflationFactor *= 1 + monthlyInflationRate;
    cumulativeContributions += contributions;
    cumulativeWithdrawals += withdrawals;
    cumulativeGrowth += growth;
    cumulativeFees += fees;
    cumulativeTaxes += taxes;
    points.push({
      date: format(
        addMonths(parseISO(scenario.startDate), month + 1),
        "yyyy-MM-dd",
      ),
      contributions: roundMoney(cumulativeContributions),
      withdrawals: roundMoney(cumulativeWithdrawals),
      growth: roundMoney(cumulativeGrowth),
      fees: roundMoney(cumulativeFees),
      taxes: roundMoney(cumulativeTaxes),
      nominalBalance: roundMoney(balance),
      purchasingPower: roundMoney(balance / inflationFactor),
    });
  }

  return {
    scenario: projectionName,
    annualReturn,
    futureInflationRate,
    points,
    limitIssues: contributionLimitIssues(
      scenario.wrapper,
      appliedContributions,
    ),
    contributionRule:
      scenario.wrapper === "taxable"
        ? null
        : { wrapper: scenario.wrapper, ...WRAPPER_RULES[scenario.wrapper] },
    unsupportedCases: unsupportedCases(scenario),
    lineage: [
      `compound-growth-calculation:${COMPOUND_GROWTH_CALCULATION_VERSION}`,
      `assumptions:${scenario.id}`,
      `return-convention:${scenario.returnConvention.kind}`,
      `return-type:${scenario.returnType}`,
      `future-return:hypothetical:${annualReturn}`,
      `future-inflation:hypothetical:${futureInflationRate}`,
      ...(scenario.wrapper === "taxable"
        ? [`tax-treatment:flat-growth-rate:${scenario.taxableGrowthTaxRate}`]
        : [
            `tax-treatment:${scenario.wrapper}:growth-tax-exempt`,
            `contribution-limit:${scenario.wrapper}:${WRAPPER_RULES[scenario.wrapper].limit}:${WRAPPER_RULES[scenario.wrapper].sourceUrl}`,
          ]),
      ...scenario.linkedAccounts.map(
        (account) => `linked-account:${account.id}`,
      ),
    ],
  };
}

export function projectCompoundGrowth(
  scenario: GrowthScenario,
): GrowthProjection[] {
  return [
    simulate(
      scenario,
      "expected",
      scenario.annualReturn,
      scenario.futureInflationRate,
    ),
    simulate(
      scenario,
      "downside",
      Math.max(scenario.annualReturn - scenario.stressReturnDelta, -0.99),
      scenario.futureInflationRate + scenario.stressInflationDelta,
    ),
    simulate(
      scenario,
      "upside",
      scenario.annualReturn + scenario.stressReturnDelta,
      Math.max(
        scenario.futureInflationRate - scenario.stressInflationDelta,
        -0.99,
      ),
    ),
  ];
}
