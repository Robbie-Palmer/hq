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
  type RetirementCapitalForecast,
  type RetirementCapitalForecastPoint,
  type RetirementCapitalScenario,
} from "./retirementCapital";
import type { RetirementIncomeStream } from "./retirementIncome";

export const RETIREMENT_PROJECTION_HORIZONS = [10, 15, 20, 30] as const;

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
  accounts: RetirementCapitalAccount[];
  withdrawalOrder: string[];
};

export type RetirementPathOptions = {
  retireEarlierYears: number;
  workLongerYears: number;
  lowerIncomeRate: number;
};

export type RetirementProjectionPath = {
  id: "planned" | "earlier" | "longer" | "lower-income";
  name: string;
  retirementDate: string;
  annualNetEmploymentIncome: number;
};

export type RetirementProjectionOutcome = {
  horizonYears: RetirementProjectionHorizon;
  forecastDate: string;
  accessibleCapitalExhaustionDate: string | null;
  accessibleCapital: number;
  totalNetWorth: number;
  incomeCoverage: number;
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
  outcome: RetirementProjectionOutcome;
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
  for (const years of [
    pathOptions.retireEarlierYears,
    pathOptions.workLongerYears,
  ]) {
    if (!Number.isInteger(years) || years < 0) {
      throw new Error(
        "Retirement timing changes must be whole non-negative years",
      );
    }
  }
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
  const planned = parseISO(facts.plannedRetirementDate);
  const earlier = isoDate(addYears(planned, -options.retireEarlierYears));
  return [
    {
      id: "planned",
      name: "Planned retirement",
      retirementDate: facts.plannedRetirementDate,
      annualNetEmploymentIncome: facts.annualNetEmploymentIncome,
    },
    {
      id: "earlier",
      name: `Retire ${options.retireEarlierYears} years earlier`,
      retirementDate: earlier < facts.startDate ? facts.startDate : earlier,
      annualNetEmploymentIncome: facts.annualNetEmploymentIncome,
    },
    {
      id: "longer",
      name: `Work ${options.workLongerYears} years longer`,
      retirementDate: isoDate(addYears(planned, options.workLongerYears)),
      annualNetEmploymentIncome: facts.annualNetEmploymentIncome,
    },
    {
      id: "lower-income",
      name: `${Math.round(options.lowerIncomeRate * 100)}% replacement income`,
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
}): RetirementIncomeStream | null {
  if (
    input.path.annualNetEmploymentIncome <= 0 ||
    input.path.retirementDate <= input.facts.startDate
  ) {
    return null;
  }
  return {
    id: "employment-income",
    name: "Net employment income",
    kind: "other",
    ownerId: "household",
    amount: input.path.annualNetEmploymentIncome,
    amountBasis: "net",
    frequency: "annual",
    currency: "GBP",
    startDate: input.facts.startDate,
    endDate: isoDate(addMonths(parseISO(input.path.retirementDate), -1)),
    inflation: { kind: "level" },
    provenance: {
      kind: "manual-estimate",
      note: "Retirement stress-range starting fact",
    },
    taxTreatment: { kind: "already-net" },
    interactingBenefits: [],
  };
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
    employmentIncomeStream(input),
    delayedIncomeStream({
      facts: input.facts,
      annualInflation: input.assumption.annualInflation,
      startDate: input.facts.delayedIncomeStartDate,
    }),
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
    (sum, item) => sum + item.retirementIncome.netAmount,
    0,
  );
  return {
    horizonYears,
    forecastDate: point.date,
    accessibleCapitalExhaustionDate:
      forecast.accessibleCapitalExhaustionDate != null &&
      forecast.accessibleCapitalExhaustionDate <= point.date
        ? forecast.accessibleCapitalExhaustionDate
        : null,
    accessibleCapital: point.accessibleCapital,
    totalNetWorth: point.totalNetWorth,
    incomeCoverage: totalSpending === 0 ? 1 : totalIncome / totalSpending,
    cumulativeTax: points.reduce((sum, item) => sum + item.tax, 0),
    cumulativeFees: points.reduce((sum, item) => sum + item.fees, 0),
    cumulativeShortfall: points.reduce(
      (sum, item) => sum + item.spendingShortfall,
      0,
    ),
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
      parseISO(input.path.retirementDate),
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
      path.id === "planned" && centralForecast != null
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
      outcome: outcomeFromForecast(forecast, 20, input.facts.startDate),
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
