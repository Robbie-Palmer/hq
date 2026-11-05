import {
  addMonths,
  addYears,
  differenceInCalendarMonths,
  format,
  parseISO,
} from "date-fns";
import { isLiability } from "./account";
import {
  projectRetirementCapital,
  type RetirementCapitalAccount,
  type RetirementCapitalContribution,
  type RetirementCapitalForecast,
  type RetirementCapitalForecastPoint,
  type RetirementCapitalScenario,
  type RetirementHousingRelease,
} from "./retirementCapital";
import type { RetirementIncomeStream } from "./retirementIncome";

export const RETIREMENT_PROJECTION_HORIZONS = [10, 15, 20, 30] as const;
export const RETIREMENT_CHOICE_HORIZONS = [10, 15, 20] as const;

export type RetirementProjectionHorizon =
  (typeof RETIREMENT_PROJECTION_HORIZONS)[number];

export type RetirementAssumptionSet = {
  id: string;
  name: string;
  annualReturn: number;
  annualInflation: number;
  annualSpendingChange: number;
  annualFeeRate: number;
  longevityYears: number;
  earlyReturnShock: number;
  earlyReturnShockYears: number;
};

export type RetirementProjectionFacts = {
  startDate: string;
  plannedRetirementDate: string;
  annualSpending: number;
  annualNetEmploymentIncome: number;
  delayedIncomeAnnual: number;
  delayedIncomeStartDate: string;
  retirementIncomeStreams?: RetirementIncomeStream[];
  contributionPlan?: {
    accountId: string;
    annualEmployeeGross: number;
    annualEmployer: number;
  };
  housingReleases?: RetirementHousingRelease[];
  accounts: RetirementCapitalAccount[];
  withdrawalOrder: string[];
};

export type RetirementPathOptions = {
  lowerIncomeRate: number;
};

export type RetirementProjectionPath = {
  id: "stop-work" | "stay-in-work" | "reduced-work";
  name: string;
  retirementDate: string | null;
  annualNetEmploymentIncome: number;
};

export type RetirementProjectionOutcome = {
  horizonYears: RetirementProjectionHorizon;
  forecastDate: string;
  accessibleCapitalExhaustionDate: string | null;
  cashRunwayMonths: number | null;
  portfolioSurvives: boolean;
  liquidWithdrawalCapital: number;
  accessibleCapital: number;
  restrictedPensionCapital: number;
  retainedHomeEquity: number;
  liabilities: number;
  totalNetWorth: number;
  retirementIncomeCoverage: number;
  cumulativeTax: number;
  cumulativeFees: number;
  cumulativeShortfall: number;
};

export type RetirementProjectionEffects = {
  horizonYears: 20;
  earlyMarketSequence: number;
  inflation: number;
  spendingChange: number;
  delayedIncome: number;
  withdrawalTax: number;
};

export type RetirementAssumptionComparison = {
  assumption: RetirementAssumptionSet;
  path: RetirementProjectionPath;
  outcomes: RetirementProjectionOutcome[];
  effects: RetirementProjectionEffects;
};

export type RetirementPathComparison = {
  path: RetirementProjectionPath;
  assumption: RetirementAssumptionSet;
  outcomes: RetirementProjectionOutcome[];
};

export type RetirementProjectionRangeComparison = {
  assumptionComparisons: RetirementAssumptionComparison[];
  pathComparisons: RetirementPathComparison[];
  restrictions: string[];
};

function isoDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function assertRate(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= -1) {
    throw new Error(`${name} must be a finite rate above -100%`);
  }
}

function validateFacts(facts: RetirementProjectionFacts): void {
  if (facts.plannedRetirementDate < facts.startDate) {
    throw new Error(
      "The planned retirement date cannot precede the start date",
    );
  }
  for (const [name, value] of [
    ["Annual spending", facts.annualSpending],
    ["Annual net employment income", facts.annualNetEmploymentIncome],
    ["Delayed annual income", facts.delayedIncomeAnnual],
    [
      "Annual employee pension contribution",
      facts.contributionPlan?.annualEmployeeGross ?? 0,
    ],
    [
      "Annual employer pension contribution",
      facts.contributionPlan?.annualEmployer ?? 0,
    ],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a non-negative number`);
    }
  }
}

function validateAssumption(assumption: RetirementAssumptionSet): void {
  if (assumption.name.trim() === "") {
    throw new Error("Retirement assumption sets need names");
  }
  assertRate("Annual return", assumption.annualReturn);
  assertRate("Annual inflation", assumption.annualInflation);
  assertRate("Annual spending change", assumption.annualSpendingChange);
  if (
    !Number.isFinite(assumption.annualFeeRate) ||
    assumption.annualFeeRate < 0 ||
    assumption.annualFeeRate >= 1
  ) {
    throw new Error("Annual fees must be between 0% and 100%");
  }
  if (
    !Number.isInteger(assumption.longevityYears) ||
    assumption.longevityYears < 30
  ) {
    throw new Error("Longevity horizons must be whole years of at least 30");
  }
  if (
    !Number.isInteger(assumption.earlyReturnShockYears) ||
    assumption.earlyReturnShockYears < 0
  ) {
    throw new Error(
      "Early return shock durations must be whole non-negative years",
    );
  }
  assertRate(
    "Early stressed return after fees",
    assumption.annualReturn -
      assumption.annualFeeRate +
      assumption.earlyReturnShock,
  );
}

function validatePathOptions(pathOptions: RetirementPathOptions): void {
  if (
    !Number.isFinite(pathOptions.lowerIncomeRate) ||
    pathOptions.lowerIncomeRate < 0 ||
    pathOptions.lowerIncomeRate > 1
  ) {
    throw new Error("Lower replacement income must be between 0% and 100%");
  }
}

function withdrawalSupportIssues(
  facts: RetirementProjectionFacts,
  accountsById: ReadonlyMap<string, RetirementCapitalAccount>,
): string[] {
  const issues: string[] = [];
  for (const accountId of facts.withdrawalOrder) {
    const account = accountsById.get(accountId);
    if (account == null) continue;
    if (account.accessPolicy?.taxTreatment?.kind === "unsupported") {
      issues.push(
        `${account.name}: ${account.accessPolicy.taxTreatment.reason}`,
      );
    }
    if (
      account.accessPolicy?.taxTreatment == null &&
      account.taxWrapper !== "isa" &&
      account.assetType !== "cash"
    ) {
      issues.push(
        `${account.name}: ${account.taxWrapper ?? "taxable"} withdrawal tax has not been configured`,
      );
    }
    if (
      account.taxWrapper === "pension" &&
      account.accessPolicy?.accessibleFromDate == null
    ) {
      issues.push(`${account.name}: add a pension access date`);
    }
  }
  return issues;
}

function contributionSupportIssues(
  facts: RetirementProjectionFacts,
  accountsById: ReadonlyMap<string, RetirementCapitalAccount>,
): string[] {
  const contributionPlan = facts.contributionPlan;
  if (
    contributionPlan != null &&
    contributionPlan.annualEmployeeGross + contributionPlan.annualEmployer >
      0 &&
    accountsById.get(contributionPlan.accountId)?.taxWrapper !== "pension"
  ) {
    return ["Pension contributions need a tracked pension account"];
  }
  return [];
}

function incomeSupportIssues(facts: RetirementProjectionFacts): string[] {
  const issues: string[] = [];
  for (const stream of facts.retirementIncomeStreams ?? []) {
    if (stream.currency !== "GBP") {
      issues.push(`${stream.name}: add a GBP exchange-rate assumption`);
    }
    if (stream.taxTreatment.kind === "unsupported") {
      issues.push(`${stream.name}: ${stream.taxTreatment.reason}`);
    }
    if (stream.interactingBenefits.length > 0) {
      issues.push(
        `${stream.name}: interacting benefits need a supported calculation`,
      );
    }
    if (
      stream.kind === "rental-income" &&
      (stream.rentalIncome?.annualResidentialFinanceCosts ?? 0) > 0
    ) {
      issues.push(
        `${stream.name}: residential finance-cost tax relief needs a supported calculation`,
      );
    }
  }
  return issues;
}

export function retirementReadinessBlockingIssues(
  facts: RetirementProjectionFacts,
): string[] {
  const accountsById = new Map(
    facts.accounts.map((account) => [account.id, account]),
  );
  const issues = [
    ...withdrawalSupportIssues(facts, accountsById),
    ...contributionSupportIssues(facts, accountsById),
    ...incomeSupportIssues(facts),
  ];
  return [...new Set(issues)];
}

function validateInput(input: {
  facts: RetirementProjectionFacts;
  assumptionSets: readonly RetirementAssumptionSet[];
  pathOptions: RetirementPathOptions;
}): void {
  const { facts, assumptionSets, pathOptions } = input;
  validateFacts(facts);
  if (assumptionSets.length === 0) {
    throw new Error("At least one retirement assumption set is required");
  }
  if (
    new Set(assumptionSets.map(({ id }) => id)).size !== assumptionSets.length
  ) {
    throw new Error("Retirement assumption set IDs must be unique");
  }
  for (const assumption of assumptionSets) {
    validateAssumption(assumption);
  }
  validatePathOptions(pathOptions);
}

export function retirementProjectionPaths(
  facts: RetirementProjectionFacts,
  options: RetirementPathOptions,
): RetirementProjectionPath[] {
  return [
    {
      id: "stop-work",
      name: "Stop work",
      retirementDate: facts.plannedRetirementDate,
      annualNetEmploymentIncome: 0,
    },
    {
      id: "stay-in-work",
      name: "Stay in work",
      retirementDate: null,
      annualNetEmploymentIncome: facts.annualNetEmploymentIncome,
    },
    {
      id: "reduced-work",
      name: `Reduce earned income to ${Math.round(options.lowerIncomeRate * 100)}%`,
      retirementDate: facts.plannedRetirementDate,
      annualNetEmploymentIncome:
        facts.annualNetEmploymentIncome * options.lowerIncomeRate,
    },
  ];
}

function scenarioAccounts(
  accounts: readonly RetirementCapitalAccount[],
  startDate: string,
  assumption: RetirementAssumptionSet,
  earlyReturnShock: number,
): RetirementCapitalAccount[] {
  const steadyReturn = assumption.annualReturn - assumption.annualFeeRate;
  return accounts.map((account) => {
    if (isLiability(account.assetType) || account.assetType === "property") {
      return { ...account };
    }
    const changes =
      assumption.earlyReturnShockYears === 0
        ? []
        : [
            {
              date: isoDate(
                addYears(parseISO(startDate), assumption.earlyReturnShockYears),
              ),
              rate: steadyReturn,
            },
          ];
    return {
      ...account,
      expectedAnnualReturn: steadyReturn + earlyReturnShock,
      expectedReturnChanges: changes,
    };
  });
}

function employmentIncomeStream(input: {
  facts: RetirementProjectionFacts;
  path: RetirementProjectionPath;
  endDate: string;
}): RetirementIncomeStream[] {
  if (input.facts.annualNetEmploymentIncome <= 0) return [];
  const fullIncomeEndDate =
    input.path.retirementDate == null
      ? input.endDate
      : isoDate(addMonths(parseISO(input.path.retirementDate), -1));
  const fullIncome: RetirementIncomeStream = {
    id: `employment-income-full-${input.path.id}`,
    name: "Full net employment income",
    kind: "other",
    ownerId: "household",
    amount: input.facts.annualNetEmploymentIncome,
    amountBasis: "net",
    frequency: "annual",
    currency: "GBP",
    startDate: input.facts.startDate,
    endDate: fullIncomeEndDate,
    inflation: { kind: "level" },
    provenance: {
      kind: "manual-estimate",
      note: "Retirement stress-range starting fact",
    },
    taxTreatment: { kind: "already-net" },
    interactingBenefits: [],
  };
  const streams: RetirementIncomeStream[] =
    fullIncomeEndDate < input.facts.startDate ? [] : [fullIncome];
  if (
    input.path.id === "reduced-work" &&
    input.path.annualNetEmploymentIncome > 0 &&
    input.path.retirementDate != null
  ) {
    streams.push({
      ...fullIncome,
      id: "employment-income-reduced-work",
      name: "Reduced net employment income",
      amount: input.path.annualNetEmploymentIncome,
      startDate: input.path.retirementDate,
      endDate: input.endDate,
    });
  }
  return streams;
}

type RetirementContributionPeriod = {
  id: "full" | "reduced";
  startDate: string;
  endDate: string;
  multiplier: number;
};

function retirementContributionPeriods(input: {
  facts: RetirementProjectionFacts;
  path: RetirementProjectionPath;
  endDate: string;
}): RetirementContributionPeriod[] {
  if (input.path.id === "stay-in-work") {
    return [
      {
        id: "full",
        startDate: input.facts.startDate,
        endDate: input.endDate,
        multiplier: 1,
      },
    ];
  }
  const fullPeriod: RetirementContributionPeriod = {
    id: "full",
    startDate: input.facts.startDate,
    endDate: isoDate(
      addMonths(parseISO(input.facts.plannedRetirementDate), -1),
    ),
    multiplier: 1,
  };
  if (input.path.id === "stop-work") return [fullPeriod];
  return [
    fullPeriod,
    {
      id: "reduced",
      startDate: input.facts.plannedRetirementDate,
      endDate: input.endDate,
      multiplier:
        input.path.annualNetEmploymentIncome /
        Math.max(input.facts.annualNetEmploymentIncome, 1),
    },
  ];
}

function retirementContributions(input: {
  facts: RetirementProjectionFacts;
  path: RetirementProjectionPath;
  endDate: string;
}): RetirementCapitalContribution[] {
  const plan = input.facts.contributionPlan;
  if (plan == null) return [];
  const periods = retirementContributionPeriods(input);
  return periods.flatMap((period) =>
    [
      {
        id: `employee-pension-${input.path.id}-${period.id}`,
        label: "Gross employee pension contribution",
        accountId: plan.accountId,
        kind: "employee-gross" as const,
        annualAmount: plan.annualEmployeeGross * period.multiplier,
        startDate: period.startDate,
        endDate: period.endDate,
      },
      {
        id: `employer-pension-${input.path.id}-${period.id}`,
        label: "Employer pension contribution",
        accountId: plan.accountId,
        kind: "employer" as const,
        annualAmount: plan.annualEmployer * period.multiplier,
        startDate: period.startDate,
        endDate: period.endDate,
      },
    ].filter(
      ({ annualAmount, startDate, endDate }) =>
        annualAmount > 0 && startDate <= endDate,
    ),
  );
}

function delayedIncomeStream(input: {
  facts: RetirementProjectionFacts;
  annualInflation: number;
  startDate: string;
}): RetirementIncomeStream | null {
  if (input.facts.delayedIncomeAnnual <= 0) return null;
  return {
    id: "delayed-retirement-income",
    name: "Delayed retirement income",
    kind: "other",
    ownerId: "household",
    amount: input.facts.delayedIncomeAnnual,
    amountBasis: "net",
    frequency: "annual",
    currency: "GBP",
    startDate: input.startDate,
    inflation: {
      kind: "fixed-rate",
      annualRate: input.annualInflation,
    },
    provenance: {
      kind: "manual-estimate",
      note: "Retirement stress-range starting fact",
    },
    taxTreatment: { kind: "already-net" },
    interactingBenefits: [],
  };
}

function buildScenario(input: {
  facts: RetirementProjectionFacts;
  assumption: RetirementAssumptionSet;
  path: RetirementProjectionPath;
  endDate: string;
}): RetirementCapitalScenario {
  const streams = [
    ...employmentIncomeStream({ ...input, endDate: input.endDate }),
    delayedIncomeStream({
      facts: input.facts,
      annualInflation: input.assumption.annualInflation,
      startDate: input.facts.delayedIncomeStartDate,
    }),
    ...(input.facts.retirementIncomeStreams ?? []),
  ].filter((stream): stream is RetirementIncomeStream => stream != null);
  return {
    id: `${input.assumption.id}-${input.path.id}`,
    label: `${input.assumption.name}, ${input.path.name}`,
    startDate: input.facts.startDate,
    endDate: input.endDate,
    annualSpending: input.facts.annualSpending,
    annualSpendingGrowthRate:
      (1 + input.assumption.annualInflation) *
        (1 + input.assumption.annualSpendingChange) -
      1,
    accounts: scenarioAccounts(
      input.facts.accounts,
      input.facts.startDate,
      input.assumption,
      input.assumption.earlyReturnShock,
    ),
    withdrawalOrder: input.facts.withdrawalOrder,
    incomeStreams: streams,
    contributions: retirementContributions(input),
    housingReleases: input.facts.housingReleases,
  };
}

function runForecast(input: {
  facts: RetirementProjectionFacts;
  assumption: RetirementAssumptionSet;
  path: RetirementProjectionPath;
  horizonYears: number;
}): RetirementCapitalForecast {
  return projectRetirementCapital(
    buildScenario({
      ...input,
      endDate: isoDate(
        addYears(parseISO(input.facts.startDate), input.horizonYears),
      ),
    }),
  );
}

function pointAtHorizon(
  forecast: RetirementCapitalForecast,
  forecastDate: string,
): RetirementCapitalForecastPoint {
  const point = forecast.points.findLast(({ date }) => date <= forecastDate);
  if (point == null) throw new Error("Retirement forecast produced no points");
  return point;
}

function outcomeFromForecast(
  forecast: RetirementCapitalForecast,
  horizonYears: RetirementProjectionHorizon,
  startDate: string,
): RetirementProjectionOutcome {
  const forecastDate = isoDate(addYears(parseISO(startDate), horizonYears));
  const points = forecast.points.filter(({ date }) => date <= forecastDate);
  const point = pointAtHorizon(forecast, forecastDate);
  const totalSpending = points.reduce(
    (sum, item) => sum + item.spendingRequired,
    0,
  );
  const totalIncome = points.reduce(
    (sum, item) =>
      sum +
      item.retirementIncome.streams
        .filter(({ streamId }) => !streamId.startsWith("employment-income-"))
        .reduce((streamSum, stream) => streamSum + stream.netAmount, 0),
    0,
  );
  const cumulativeShortfall = points.reduce(
    (sum, item) => sum + item.spendingShortfall,
    0,
  );
  const exhaustionDate =
    forecast.accessibleCapitalExhaustionDate != null &&
    forecast.accessibleCapitalExhaustionDate <= point.date
      ? forecast.accessibleCapitalExhaustionDate
      : null;
  return {
    horizonYears,
    forecastDate: point.date,
    accessibleCapitalExhaustionDate: exhaustionDate,
    cashRunwayMonths:
      exhaustionDate == null
        ? null
        : Math.max(
            differenceInCalendarMonths(
              parseISO(exhaustionDate),
              parseISO(startDate),
            ),
            0,
          ),
    portfolioSurvives: cumulativeShortfall === 0,
    liquidWithdrawalCapital: point.liquidWithdrawalCapital,
    accessibleCapital: point.accessibleCapital,
    restrictedPensionCapital: point.restrictedPensionCapital,
    retainedHomeEquity: point.retainedHomeEquity,
    liabilities: point.liabilities,
    totalNetWorth: point.totalNetWorth,
    retirementIncomeCoverage:
      totalSpending === 0 ? 1 : totalIncome / totalSpending,
    cumulativeTax: points.reduce((sum, item) => sum + item.tax, 0),
    cumulativeFees: points.reduce((sum, item) => sum + item.fees, 0),
    cumulativeShortfall,
  };
}

function cumulativeSpending(
  annualSpending: number,
  annualGrowthRate: number,
  years: number,
): number {
  let total = 0;
  for (let month = 0; month <= years * 12; month += 1) {
    total += (annualSpending / 12) * (1 + annualGrowthRate) ** (month / 12);
  }
  return total;
}

function earlySequenceEffect(input: {
  facts: RetirementProjectionFacts;
  assumption: RetirementAssumptionSet;
  horizonYears: number;
}): number {
  const openingInvestedCapital = input.facts.accounts
    .filter(
      (account) =>
        account.balance > 0 &&
        !isLiability(account.assetType) &&
        account.assetType !== "property",
    )
    .reduce((sum, account) => sum + account.balance, 0);
  const shockYears = Math.min(
    input.assumption.earlyReturnShockYears,
    input.horizonYears,
  );
  const steadyReturn =
    input.assumption.annualReturn - input.assumption.annualFeeRate;
  const shockedReturn = steadyReturn + input.assumption.earlyReturnShock;
  return (
    openingInvestedCapital *
      (1 + shockedReturn) ** shockYears *
      (1 + steadyReturn) ** (input.horizonYears - shockYears) -
    openingInvestedCapital * (1 + steadyReturn) ** input.horizonYears
  );
}

function delayedIncomeEffect(input: {
  facts: RetirementProjectionFacts;
  path: RetirementProjectionPath;
  assumption: RetirementAssumptionSet;
  horizonYears: number;
}): number {
  const horizonDate = isoDate(
    addYears(parseISO(input.facts.startDate), input.horizonYears),
  );
  const delayedStart =
    input.facts.delayedIncomeStartDate < horizonDate
      ? input.facts.delayedIncomeStartDate
      : horizonDate;
  const months = Math.max(
    differenceInCalendarMonths(
      parseISO(delayedStart),
      parseISO(input.facts.plannedRetirementDate),
    ),
    0,
  );
  let missedIncome = 0;
  for (let month = 0; month < months; month += 1) {
    missedIncome +=
      (input.facts.delayedIncomeAnnual / 12) *
      (1 + input.assumption.annualInflation) ** (month / 12);
  }
  return -missedIncome;
}

function effectsAtTwentyYears(input: {
  facts: RetirementProjectionFacts;
  assumption: RetirementAssumptionSet;
  path: RetirementProjectionPath;
  forecast: RetirementCapitalForecast;
}): RetirementProjectionEffects {
  const horizonYears = 20;
  const date = isoDate(addYears(parseISO(input.facts.startDate), horizonYears));
  const points = input.forecast.points.filter(
    ({ date: pointDate }) => pointDate <= date,
  );
  const combinedSpendingGrowth =
    (1 + input.assumption.annualInflation) *
      (1 + input.assumption.annualSpendingChange) -
    1;
  const totalSpending = cumulativeSpending(
    input.facts.annualSpending,
    combinedSpendingGrowth,
    horizonYears,
  );
  return {
    horizonYears,
    earlyMarketSequence: earlySequenceEffect({ ...input, horizonYears }),
    inflation:
      cumulativeSpending(
        input.facts.annualSpending,
        input.assumption.annualSpendingChange,
        horizonYears,
      ) - totalSpending,
    spendingChange:
      cumulativeSpending(
        input.facts.annualSpending,
        input.assumption.annualInflation,
        horizonYears,
      ) - totalSpending,
    delayedIncome: delayedIncomeEffect({ ...input, horizonYears }),
    withdrawalTax: -points.reduce((sum, point) => sum + point.tax, 0),
  };
}

function forecastRestrictions(forecast: RetirementCapitalForecast): string[] {
  const restrictions = forecast.points.flatMap((point) => [
    ...point.restrictions.map(({ detail }) => detail),
    ...point.retirementIncome.issues.map(({ detail }) => detail),
  ]);
  return [...new Set(restrictions)];
}

export function compareRetirementProjectionRanges(input: {
  facts: RetirementProjectionFacts;
  assumptionSets: readonly RetirementAssumptionSet[];
  pathOptions: RetirementPathOptions;
}): RetirementProjectionRangeComparison {
  validateInput(input);
  const blockingIssues = retirementReadinessBlockingIssues(input.facts);
  if (blockingIssues.length > 0) {
    throw new Error(
      `Cannot show retirement forecast: ${blockingIssues.join("; ")}`,
    );
  }
  const paths = retirementProjectionPaths(input.facts, input.pathOptions);
  const plannedPath = paths[0] as RetirementProjectionPath;
  const forecasts = input.assumptionSets.map((assumption) => ({
    assumption,
    forecast: runForecast({
      facts: input.facts,
      assumption,
      path: plannedPath,
      horizonYears: assumption.longevityYears,
    }),
  }));
  const assumptionComparisons = forecasts.map(({ assumption, forecast }) => ({
    assumption,
    path: plannedPath,
    outcomes: RETIREMENT_PROJECTION_HORIZONS.map((horizon) =>
      outcomeFromForecast(forecast, horizon, input.facts.startDate),
    ),
    effects: effectsAtTwentyYears({
      facts: input.facts,
      assumption,
      path: plannedPath,
      forecast,
    }),
  }));
  const central =
    input.assumptionSets.find(({ id }) => id === "central") ??
    input.assumptionSets[0];
  if (central == null) throw new Error("A central assumption set is required");
  const centralForecast = forecasts.find(
    ({ assumption }) => assumption.id === central.id,
  )?.forecast;
  const pathComparisons = paths.map((path) => {
    const forecast =
      path.id === "stop-work" && centralForecast != null
        ? centralForecast
        : runForecast({
            facts: input.facts,
            assumption: central,
            path,
            horizonYears: 20,
          });
    return {
      path,
      assumption: central,
      outcomes: RETIREMENT_CHOICE_HORIZONS.map((horizon) =>
        outcomeFromForecast(forecast, horizon, input.facts.startDate),
      ),
    };
  });
  return {
    assumptionComparisons,
    pathComparisons,
    restrictions: forecastRestrictions(
      forecasts[0]?.forecast ??
        runForecast({
          facts: input.facts,
          assumption: central,
          path: plannedPath,
          horizonYears: 30,
        }),
    ),
  };
}
