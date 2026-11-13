import type { LimitedCompanyScenarioInput } from "personal-finance-contracts/limited-company-scenario";
import { multiPeriodLimitedCompanyScenario } from "personal-finance-contracts/limited-company-synthetic-scenarios";
import type {
  BusinessFiPlanInput,
  HouseholdWealthConsolidation,
  ShareOwnershipInterest,
} from "@/app/_projects/personal-finance-app/domain";

const acceptedAt = "2028-04-06T00:00:00.000Z";

export function businessFiWealthFixture(): HouseholdWealthConsolidation {
  return {
    calculationVersion: "business-wealth-consolidation-v1",
    validAt: "2025-04-06",
    asKnownAt: acceptedAt,
    baseCurrency: "GBP",
    knownSubtotal: 300_000,
    complete: true,
    contributions: [
      {
        id: "account:household-cash",
        kind: "account",
        subjectId: "household-cash",
        amount: 50_000,
        currency: "GBP",
        attribution: [
          {
            personEntityId: "person:owner",
            fraction: 1,
            amount: 50_000,
          },
        ],
        inputRecordIds: ["household-cash-value"],
      },
      {
        id: "business-interest:business:software-company",
        kind: "business-interest",
        subjectId: "business:software-company",
        amount: 250_000,
        currency: "GBP",
        attribution: [
          {
            personEntityId: "person:owner",
            fraction: 1,
            amount: 250_000,
          },
        ],
        inputRecordIds: [
          "valuation:software-company",
          "ownership:software-company:full",
        ],
      },
    ],
    businessReconciliations: [
      {
        companyEntityId: "business:software-company",
        contributionId: "business-interest:business:software-company",
        basis: "underlying-company-position",
        method: "adjusted-net-assets",
        valuationRecordId: "valuation:software-company",
        valuationValidAt: "2025-04-06",
        valuationEvidenceAt: "2025-04-06T00:00:00.000Z",
        valuationLineage: {
          kind: "derived",
          sourceId: "synthetic-company-position",
          sourceRevision: "1",
          parentRecordIds: ["company-cash", "company-liabilities"],
        },
        wholeCompanyAmount: 250_000,
        selectedOwnershipFraction: 1,
        selectedInterestAmount: 250_000,
        outsideOwnershipFraction: 0,
        excludedUnderlyingIds: ["company-cash", "company-liabilities"],
        operatingReserve: undefined,
      },
    ],
    includedContributionIds: [
      "account:household-cash",
      "business-interest:business:software-company",
    ],
    excludedUnderlyingIds: ["company-cash", "company-liabilities"],
    excludedBusinessIds: [],
    eliminatedTransferIds: [],
    valuationRecordIds: ["valuation:software-company"],
    valuationTreatmentRecordIds: [],
    ownershipRecordIds: ["ownership:software-company:full"],
    exchangeRateObservationIds: [],
    issues: [],
  };
}

export function fullBusinessOwnershipFixture(): ShareOwnershipInterest[] {
  return [
    {
      recordId: "ownership:software-company:full",
      interestId: "software-company:ordinary",
      ownerEntityId: "person:owner",
      companyEntityId: "business:software-company",
      interestClass: "ordinary",
      fraction: { state: "known", fraction: 1 },
      effectiveFrom: "2025-04-06",
      acceptedAt,
      lineage: {
        kind: "manual",
        sourceId: "synthetic-share-register",
        sourceRevision: "1",
        parentRecordIds: [],
      },
    },
  ];
}

function periodDate(
  scenario: LimitedCompanyScenarioInput,
  companyPeriodId: string,
): string {
  const period = scenario.companyPeriods.find(
    ({ id }) => id === companyPeriodId,
  );
  if (period == null)
    throw new Error(`Missing synthetic period ${companyPeriodId}`);
  return period.accountingPeriodEndsOn;
}

export function businessFiPlanFixture(
  input: {
    scenario?: LimitedCompanyScenarioInput;
    strategyId?: string;
    reflectedEventIds?: readonly string[];
  } = {},
): BusinessFiPlanInput {
  const scenario = input.scenario ?? multiPeriodLimitedCompanyScenario;
  const strategyId = input.strategyId ?? scenario.strategies[0]?.id;
  if (strategyId == null) throw new Error("Synthetic scenario has no strategy");
  const strategy = scenario.strategies.find(({ id }) => id === strategyId);
  if (strategy == null)
    throw new Error(`Missing synthetic strategy ${strategyId}`);
  const periodTimings = strategy.periodPlans.map(({ companyPeriodId }) => {
    const date = periodDate(scenario, companyPeriodId);
    return {
      companyPeriodId,
      salaryPaidOn: date,
      dividendPaidOn: date,
      employerPensionContributedOn: date,
      householdCashAvailableOn: date,
    };
  });
  const liquidityConstraints = scenario.companyPeriods.map((period) => ({
    recordId: `constraint:${period.id}`,
    companyPeriodId: period.id,
    effectiveFrom: period.accountingPeriodStartsOn,
    acceptedAt,
    operatingReservePence: 0,
    companyLiabilitiesPence: 0,
    unavailableCashPence: 0,
    inputRecordIds: [`liability-ledger:${period.id}`],
  }));
  const finalPeriod = scenario.companyPeriods
    .toSorted((left, right) =>
      left.accountingPeriodEndsOn.localeCompare(right.accountingPeriodEndsOn),
    )
    .at(-1);
  if (finalPeriod == null) throw new Error("Synthetic scenario has no periods");

  return {
    id: "continue-trading",
    label: "Continue trading and extract surplus",
    planningDate:
      scenario.companyPeriods[0]?.accountingPeriodStartsOn ?? "2025-04-06",
    asKnownAt: acceptedAt,
    companyEntityId: scenario.companyId,
    ownerPersonEntityId: scenario.ownerPersonId,
    wealth: businessFiWealthFixture(),
    capitalPosition: {
      availableNowPence: 5_000_000,
      futureAccessiblePence: 1_000_000,
      pensionWealthPence: 4_000_000,
      pensionFiEligiblePence: 3_200_000,
      inputRecordIds: ["fi-capital:opening"],
    },
    shareOwnershipInterests: fullBusinessOwnershipFixture(),
    treatment: {
      kind: "limited-company-extraction",
      recordId: "fi-treatment:continue-trading",
      strategyId,
      periodTimings,
      deferredExtraction: {
        kind: "dividend",
        availableOn: finalPeriod.accountingPeriodEndsOn,
      },
    },
    limitedCompanyScenario: scenario,
    liquidityConstraints,
    pensionTreatment: {
      accountId: "pension:person:owner",
      accessPolicy: {
        accessibleFromDate: "2035-04-06",
        accessDelayMonths: 0,
        withdrawalFeeRate: 0,
        taxTreatment: { kind: "fixed-rate", rate: 0.2 },
        canFundOrdinarySpending: true,
      },
      inputRecordIds: ["pension-policy:owner"],
    },
    reflectedEventIds: input.reflectedEventIds,
  };
}
