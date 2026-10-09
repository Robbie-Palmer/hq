import { describe, expect, it } from "vitest";
import { pricePaidArchive } from "@/content/assettracker/propertyComparables";
import { housePriceIndexArchive } from "@/content/assettracker/propertyIndexHistory";
import {
  buildBaseCurrencyFlowSankeyData,
  getDemoAssetTrackerData,
} from "@/lib/assettracker";
import {
  getAllAccountDetails,
  getAssetAllocationTimeSeries,
  getLatestPortfolioValuation,
  getNetWorthTimeSeries,
} from "@/lib/domain/assettracker/assetTrackerQueries";
import { buildRepository } from "@/lib/domain/assettracker/assetTrackerRepository";
import {
  hasFxExposure,
  type NetWorthDataPoint,
  toFxImpactTimeSeries,
} from "@/lib/domain/assettracker/assetTrackerViews";
import {
  analyseEmergencyFund,
  applyEmergencyFundDerivedFacts,
  deriveEmergencyFundFacts,
} from "@/lib/domain/assettracker/emergencyFund";
import { futureCashFlowForecastItems } from "@/lib/domain/assettracker/futureCashFlow";
import {
  scopeAssetTrackerData,
  snapshotOwnershipKey,
} from "@/lib/domain/assettracker/household";
import { compareJobMoveScenario } from "@/lib/domain/assettracker/jobMoveScenario";
import { getPortfolioFinancialIndependence } from "@/lib/domain/assettracker/portfolioReconciliation";
import { valueAccountAtDate } from "@/lib/domain/assettracker/portfolioValuation";
import { buildPropertyComparableViews } from "@/lib/domain/assettracker/propertyComparables";
import { buildPropertyValueHistoryViews } from "@/lib/domain/assettracker/propertyIndexHistory";
import { currentSalaryHistory } from "@/lib/domain/assettracker/salaryHistory";
import { getHouseholdTaxEstimate } from "@/lib/domain/assettracker/taxPosition";

describe("Asset Tracker demo-data adapter", () => {
  it("includes a prospective role that changes the forecast", () => {
    const repository = buildRepository(getDemoAssetTrackerData());
    const scenario = repository.jobMoveScenarios.find(
      ({ id }) => id === "northstar-product-lead-offer",
    );
    if (scenario == null) throw new Error("Expected a demo job-move scenario");
    const financialIndependence = getPortfolioFinancialIndependence(
      repository,
      "2026-10-01",
    );
    const comparison = compareJobMoveScenario({
      repository,
      scenario,
      horizonMonths: 60,
      startDate: "2026-10-01",
      annualExpenditure: financialIndependence.representativeAnnualExpenditure,
      annualCurrentExpenditure:
        financialIndependence.representativeAnnualCurrentExpenditure,
      financialIndependenceTarget: financialIndependence.target,
      baselineCompensation: financialIndependence.currentCompensation,
      emergencyFundAnalysis: null,
    });
    const horizon = comparison.timeline.at(-1);

    expect(scenario.name).toBe("Northstar product lead offer");
    expect(comparison.compensation.scenarioAnnualTakeHomePay).toBeGreaterThan(
      comparison.compensation.baselineAnnualTakeHomePay ??
        Number.POSITIVE_INFINITY,
    );
    expect(
      comparison.timeline.some(
        ({ scenario: point }) =>
          point.spendingDrawdown.cash > 0 ||
          point.spendingDrawdown.liquid > 0 ||
          point.spendingDrawdown.illiquid > 0 ||
          point.spendingDrawdown.unfunded > 0,
      ),
    ).toBe(false);
    expect(horizon?.scenario.totalBalance).not.toBe(
      horizon?.baseline.totalBalance,
    );
  });

  it("demonstrates reserve depletion milestones during open-ended unemployment", () => {
    const repository = buildRepository(getDemoAssetTrackerData());
    const scenario = repository.jobMoveScenarios.find(
      ({ id }) => id === "open-ended-career-break",
    );
    if (scenario == null) throw new Error("Expected the career-break scenario");
    const financialIndependence = getPortfolioFinancialIndependence(
      repository,
      "2024-12-01",
    );
    const comparison = compareJobMoveScenario({
      repository,
      scenario,
      horizonMonths: 120,
      startDate: "2024-12-01",
      annualExpenditure: financialIndependence.representativeAnnualExpenditure,
      annualCurrentExpenditure:
        financialIndependence.representativeAnnualCurrentExpenditure,
      financialIndependenceTarget: financialIndependence.target,
      baselineCompensation: financialIndependence.currentCompensation,
      emergencyFundAnalysis: null,
    });

    expect(comparison.milestones.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        "income-stops",
        "cash-exhausted",
        "liquid-assets-exhausted",
        "unfunded-gap",
      ]),
    );
    expect(comparison.financialIndependenceDates.baseline).not.toBeNull();
    expect(comparison.financialIndependenceDates.scenario).toBeNull();
  });

  it("isolates the portfolio value caused by exchange-rate changes", () => {
    const series: NetWorthDataPoint[] = [
      {
        date: "2024-01-01",
        total: 180,
        conversion: {
          targetCurrency: "GBP",
          status: "complete",
          partialTotal: 180,
          accounts: [
            conversionAccount("Cash", 100, "GBP", 100),
            conversionAccount("US shares", 100, "USD", 80),
          ],
        },
      },
      {
        date: "2024-02-01",
        total: 250,
        conversion: {
          targetCurrency: "GBP",
          status: "complete",
          partialTotal: 250,
          accounts: [
            conversionAccount("Cash", 110, "GBP", 110),
            conversionAccount("US shares", 200, "USD", 140),
          ],
        },
      },
      {
        date: "2024-03-01",
        total: 120,
        conversion: {
          targetCurrency: "GBP",
          status: "complete",
          partialTotal: 120,
          accounts: [conversionAccount("Cash", 120, "GBP", 120)],
        },
      },
    ];

    expect(hasFxExposure(series, "GBP")).toBe(true);
    expect(toFxImpactTimeSeries(series, "GBP")).toEqual([
      {
        date: "2024-01-01",
        actualTotal: 180,
        fixedRateTotal: 180,
        impact: 0,
      },
      {
        date: "2024-02-01",
        actualTotal: 250,
        fixedRateTotal: 270,
        impact: -20,
      },
      {
        date: "2024-03-01",
        actualTotal: 120,
        fixedRateTotal: 120,
        impact: 0,
      },
    ]);
  });

  it("loads a fully valued multi-currency portfolio", () => {
    const repository = buildRepository(getDemoAssetTrackerData());
    const valuation = getLatestPortfolioValuation(repository);

    expect(repository.accounts.get("us-brokerage")?.currency).toBe("USD");
    expect(repository.transfers).toContainEqual(
      expect.objectContaining({
        fromAccountId: "nationwide-current",
        toAccountId: "us-brokerage",
        fromAmount: 1000,
        toAmount: 1270,
        feeAmount: 4,
        conversionProvider: "Wise",
      }),
    );
    expect(valuation?.date).toBe("2024-12-01");
    expect(valuation?.total).not.toBeNull();
    expect(valuation?.issues).toEqual([]);
    expect(getAssetAllocationTimeSeries(repository)[0]?.date).toBe(
      "2020-06-01",
    );
    expect(repository.settings.targetNetWorth).toEqual({
      amount: 500_000,
      currency: "GBP",
    });
    expect(repository.settings.withdrawalRate).toBe(0.018);
    expect(repository.incomeHistory).toHaveLength(10);
    expect(repository.incomeHistory.at(0)).toEqual({
      date: "2020-06-01",
      amount: 14_400,
      currency: "GBP",
    });
    expect(repository.incomeHistory.at(-1)).toEqual({
      date: "2024-12-01",
      amount: 19_200,
      currency: "GBP",
    });
  });

  it("starts with personal and shared household finances", () => {
    const data = getDemoAssetTrackerData();

    expect(data.household).toEqual({
      members: [
        { id: "alex", displayName: "Alex" },
        { id: "sam", displayName: "Sam" },
      ],
      activeScope: { kind: "household" },
    });
    expect(data.ownership.accounts).toMatchObject({
      "vanguard-global-all-cap": {
        kind: "personal",
        memberId: "alex",
      },
      "marcus-savings": { kind: "personal", memberId: "sam" },
      "nationwide-current": {
        kind: "shared",
        shares: [
          { memberId: "alex", share: 0.5 },
          { memberId: "sam", share: 0.5 },
        ],
      },
      home: {
        kind: "shared",
        shares: [
          { memberId: "alex", share: 0.6 },
          { memberId: "sam", share: 0.4 },
        ],
      },
    });
    expect(
      data.ownership.snapshots[snapshotOwnershipKey("home", "2024-12-01")],
    ).toEqual(data.ownership.accounts.home);
    expect(data.ownership.incomeHistory["2024-12-01"]).toEqual({
      kind: "shared",
      shares: [
        { memberId: "alex", share: 0.5 },
        { memberId: "sam", share: 0.5 },
      ],
    });

    const alexData = scopeAssetTrackerData({
      ...data,
      household: {
        ...data.household,
        activeScope: { kind: "member", memberId: "alex" },
      },
    });
    const samData = scopeAssetTrackerData({
      ...data,
      household: {
        ...data.household,
        activeScope: { kind: "member", memberId: "sam" },
      },
    });

    expect(alexData.accounts.map(({ id }) => id)).toContain(
      "vanguard-global-all-cap",
    );
    expect(alexData.accounts.map(({ id }) => id)).not.toContain(
      "marcus-savings",
    );
    expect(samData.accounts.map(({ id }) => id)).toContain("marcus-savings");
    expect(samData.accounts.map(({ id }) => id)).not.toContain(
      "vanguard-global-all-cap",
    );
    expect(
      alexData.snapshots.find(
        ({ accountId, date }) => accountId === "home" && date === "2024-12-01",
      )?.balance,
    ).toBe(178_800);
    expect(
      samData.snapshots.find(
        ({ accountId, date }) => accountId === "home" && date === "2024-12-01",
      )?.balance,
    ).toBe(119_200);
    expect(
      alexData.propertyIndexHistories?.[0]?.input.recordedValuations.map(
        ({ value }) => value,
      ),
    ).toEqual([171_000, 178_800]);
    expect(
      samData.propertyIndexHistories?.[0]?.input.recordedValuations.map(
        ({ value }) => value,
      ),
    ).toEqual([114_000, 119_200]);
    expect(alexData.propertyComparableSearches).toHaveLength(2);
    expect(samData.propertyComparableSearches).toHaveLength(2);

    const householdValue = getLatestPortfolioValuation(buildRepository(data));
    const alexValue = getLatestPortfolioValuation(buildRepository(alexData));
    const samValue = getLatestPortfolioValuation(buildRepository(samData));

    expect(householdValue?.total).not.toBeNull();
    expect(alexValue?.total).not.toBeNull();
    expect(samValue?.total).not.toBeNull();
    expect((alexValue?.total ?? 0) + (samValue?.total ?? 0)).toBeCloseTo(
      householdValue?.total ?? 0,
      2,
    );
  });

  it("showcases salary changes, period pay, pensions, and corrections", () => {
    const data = getDemoAssetTrackerData();
    const current = currentSalaryHistory(data.salaryHistory);

    expect(data.salaryHistory).toHaveLength(9);
    expect(current).toHaveLength(8);
    expect(current).toContainEqual(
      expect.objectContaining({
        id: "alex-brightwell-2016",
        effectiveStart: "2016-01-01",
        effectiveEnd: "2017-12-31",
        grossPay: 28_000,
      }),
    );
    expect(current).toContainEqual(
      expect.objectContaining({
        id: "sam-fieldwork-part-time",
        amountKind: "periodPay",
        payFrequency: "monthly",
        workFraction: 0.8,
        grossPay: 3_200,
        variablePay: 200,
        takeHomePay: 2_480,
        source: expect.objectContaining({
          kind: "file",
          fileName: "salary-history-demo.csv",
          row: 6,
        }),
      }),
    );
    expect(current).toContainEqual(
      expect.objectContaining({
        id: "alex-cirrus-2024-corrected",
        grossPay: 72_000,
        correctsId: "alex-cirrus-2024-original",
        employeePension: expect.objectContaining({
          arrangement: "salarySacrifice",
          rate: 0.06,
        }),
      }),
    );
    expect(current.map(({ id }) => id)).not.toContain(
      "alex-cirrus-2024-original",
    );
  });

  it("showcases commitments, weighted choices, and versioned forecasts", () => {
    const repository = buildRepository(getDemoAssetTrackerData());

    expect(repository.planningCases).toContainEqual({
      id: "2027-home-upgrade",
      name: "2027 home upgrade",
      description:
        "Compare committed preparation work with two possible ways to add space.",
      labels: ["home", "2027"],
      targetDate: "2027-09-01",
    });
    expect(repository.futureCashFlows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "architect-and-survey",
          kind: "commitment",
          stages: expect.arrayContaining([
            expect.objectContaining({
              id: "design-deposit",
              actuals: [
                expect.objectContaining({
                  amount: 1_500,
                  direction: "payment",
                }),
              ],
            }),
          ]),
        }),
        expect.objectContaining({
          id: "single-storey-extension",
          kind: "decision",
          status: "selected",
          confidence: 0.6,
          dependencyIds: ["architect-and-survey"],
          alternativeToIds: ["loft-conversion"],
          stages: [
            expect.objectContaining({
              minimumAmount: 35_000,
              expectedAmount: 45_000,
              maximumAmount: 55_000,
            }),
          ],
        }),
        expect.objectContaining({
          id: "loft-conversion",
          kind: "decision",
          status: "considering",
          alternativeToIds: ["single-storey-extension"],
        }),
      ]),
    );
    expect(
      futureCashFlowForecastItems(repository.futureCashFlows).map(
        ({ futureCashFlowId, amount }) => ({ futureCashFlowId, amount }),
      ),
    ).toEqual([
      { futureCashFlowId: "architect-and-survey", amount: 1_000 },
      { futureCashFlowId: "single-storey-extension", amount: 45_000 },
    ]);
    expect(repository.forecastAssumptionSets).toMatchObject([
      {
        id: "household-outlook-v2",
        version: 2,
        status: "active",
        supersedesId: "household-outlook-v1",
        assumptions: [
          {
            id: "alex-pay-rise-v2",
            source: {
              kind: "tax-derived",
              taxYear: "2027-28",
              calculationVersion: "uk-income-tax-v2",
              ruleDatasetVersion: "2026-10-01",
            },
          },
          {
            id: "temporary-storage",
            monthlyChange: { minimum: 150, expected: 250, maximum: 400 },
          },
          {
            id: "lower-energy-bills",
            monthlyChange: { minimum: -150, expected: -100, maximum: -50 },
          },
        ],
      },
      {
        id: "household-outlook-v1",
        version: 1,
        status: "superseded",
      },
    ]);

    const emergencyFundPlan = repository.emergencyFundPlans[0];
    expect(emergencyFundPlan).toMatchObject({
      id: "household-emergency-reserves-v1",
      version: 1,
      status: "active",
      coverageMonths: [6, 12, 18],
      missingData: [
        "Childcare renewal cost after 2027",
        "Outcome of the next contract renewal",
      ],
      stressScenarios: [
        expect.objectContaining({
          employmentIncomeLossRate: 1,
          sideIncomeDelayMonths: 3,
          unexpectedCost: 2_500,
          annualInflationRate: 0.04,
        }),
      ],
    });
    expect(emergencyFundPlan).toBeDefined();
    if (emergencyFundPlan == null) return;

    expect(repository.recurringFlows).toContainEqual(
      expect.objectContaining({
        id: "freelance-invoices",
        compensationKind: "sideIncome",
        amount: 650,
      }),
    );
    const financialIndependence = getPortfolioFinancialIndependence(
      repository,
      "2024-12-01",
    );
    const facts = deriveEmergencyFundFacts(
      repository,
      financialIndependence.representativeAnnualCurrentExpenditure,
      "2024-12-01",
    );

    const emergencyFundAnalysis = analyseEmergencyFund(
      repository,
      applyEmergencyFundDerivedFacts(emergencyFundPlan, facts),
      "2024-12-01",
    );
    expect(emergencyFundAnalysis.accessibleFunds).toBe(18_900);
    expect(emergencyFundAnalysis.policyTargets).toEqual([
      {
        months: 6,
        target: 9_300,
        fundingGap: 0,
        availableAboveTarget: 9_600,
      },
      {
        months: 12,
        target: 18_600,
        fundingGap: 0,
        availableAboveTarget: 300,
      },
      {
        months: 18,
        target: 27_900,
        fundingGap: 9_000,
        availableAboveTarget: 0,
      },
    ]);
    expect(emergencyFundAnalysis.selectedDecisionCosts).toBe(45_000);
    expect(
      emergencyFundAnalysis.sources.filter(({ included }) => included),
    ).toHaveLength(2);
    expect(
      emergencyFundAnalysis.sources
        .filter(({ included }) => included)
        .every(({ protectedBalance }) => protectedBalance === null),
    ).toBe(true);
  });

  it("includes a decision-ready mortgage product in the demo household", () => {
    const repository = buildRepository(getDemoAssetTrackerData());
    const mortgage = repository.accounts.get("home-mortgage");

    expect(mortgage).toMatchObject({
      assetType: "mortgage",
      linkedAccountId: "home",
      expectedAnnualReturn: 0.0425,
      expectedReturnChanges: [{ date: "2028-03-01", rate: 0.0525 }],
      mortgageTerms: {
        overpaymentAllowance: { amount: 10_000, chargeRate: 0.05 },
        fees: [{ date: "2028-03-01", amount: 999 }],
        overpayments: [{ date: "2026-06-01", amount: 5_000 }],
      },
    });
    expect(repository.accounts.get("home")?.assetType).toBe("property");
    expect(repository.mortgageScenarios).toContainEqual(
      expect.objectContaining({
        id: "five-year-fix",
        name: "Five-year fix",
        decisionRecordId: "five-year-fix-decision",
        source: {
          mortgageAccountId: "home-mortgage",
          propertyAccountId: "home",
          snapshotDate: "2024-12-01",
        },
        assumptions: expect.objectContaining({
          fixedPeriodEnd: "2030-01-01",
          initialAnnualRate: 0.0425,
          followOnAnnualRate: 0.0525,
          termMonths: 274,
        }),
      }),
    );
    expect(repository.decisionRecords).toContainEqual({
      id: "five-year-fix-decision",
      kind: "mortgage",
      title: "Five-year fix",
      scenarioId: "five-year-fix",
      recordedAt: "2024-12-01",
      status: "recorded",
    });
  });

  it("includes a sourced indexed history for the demo home", () => {
    const data = getDemoAssetTrackerData();
    const repository = buildRepository(data);
    const definition = repository.propertyIndexHistories[0];

    expect(definition).toMatchObject({
      accountId: "home",
      datasetVersion: "2026-07:654a541934ba",
      input: {
        anchorValuationId: "home-purchase-2023-03",
        recordedValuations: [
          expect.objectContaining({
            kind: "purchase-price",
            value: 285_000,
          }),
          expect.objectContaining({
            kind: "formal-valuation",
            value: 298_000,
          }),
        ],
      },
    });
    const view = buildPropertyValueHistoryViews(
      repository.propertyIndexHistories,
      housePriceIndexArchive,
    )[0];
    expect(view).toMatchObject({
      status: "ready",
      accountId: "home",
      history: {
        calculation: {
          series: {
            label: "Property-type fallback: Belfast, all",
            fallback: true,
          },
        },
      },
    });
  });

  it("showcases NI market trends and completed-sale comparables", () => {
    const repository = buildRepository(getDemoAssetTrackerData());
    const views = buildPropertyComparableViews(
      repository.propertyComparableSearches,
      pricePaidArchive,
      housePriceIndexArchive,
    );
    const homeView = views.find(({ accountId }) => accountId === "home");
    const cardiffView = views.find(
      ({ accountId }) => accountId === "cardiff-property",
    );

    expect(homeView).toMatchObject({
      status: "unsupported-region",
      accountId: "home",
      nation: "northern-ireland",
      marketTrend: {
        status: "ready",
        trend: {
          geographyName: "Belfast",
          period: "2026-06",
          averagePrice: 184_768,
        },
      },
    });
    expect(cardiffView).toMatchObject({
      status: "ready",
      accountId: "cardiff-property",
      criteria: { searchArea: { value: "CF10" } },
      sales: expect.arrayContaining([
        expect.objectContaining({ transactionId: "demo-cardiff-2026-08" }),
      ]),
    });
  });

  it("uses the corrected USD market price in the latest valuation", () => {
    const repository = buildRepository(getDemoAssetTrackerData());
    const account = repository.accounts.get("us-brokerage");

    expect(account).toBeDefined();
    if (account == null) throw new Error("Demo USD account is missing");
    const valuation = valueAccountAtDate(repository, account, "2024-12-01");

    expect(valuation.nativeCurrency).toBe("USD");
    expect(valuation.nativeValue).toBe(11_000);
    expect(valuation.value).toBeCloseTo(8_593.75);
    expect(valuation.inputObservationIds).toContain(
      "us-total-market-price-2024-12-01-corrected",
    );
    expect(valuation.inputObservationIds).not.toContain(
      "us-total-market-price-2024-12-01-original",
    );
    expect(valuation.inputObservationIds).toContain(
      "gbp-usd-2024-12-01-corrected",
    );
    expect(valuation.inputObservationIds).not.toContain(
      "gbp-usd-2024-12-01-original",
    );
  });

  it.each(["GBP", "USD", "EUR"] as const)(
    "has complete historical net worth in %s",
    (currency) => {
      const data = getDemoAssetTrackerData();
      data.settings.baseCurrency = currency;

      const series = getNetWorthTimeSeries(buildRepository(data));

      expect(series).toHaveLength(13);
      expect(series.every((point) => point.total != null)).toBe(true);
      expect(
        series.every(
          (point) =>
            point.conversion == null || point.conversion.status === "complete",
        ),
      ).toBe(true);
    },
  );

  it("includes carried, triangulated, and corrected FX examples", () => {
    const data = getDemoAssetTrackerData();
    data.settings.baseCurrency = "USD";
    const series = getNetWorthTimeSeries(buildRepository(data));

    const juneRates = series
      .find((point) => point.date === "2024-06-01")
      ?.conversion?.accounts.flatMap((account) => account.rates);
    const septemberRates = series
      .find((point) => point.date === "2024-09-15")
      ?.conversion?.accounts.flatMap((account) => account.rates);
    const decemberRates = series
      .find((point) => point.date === "2024-12-01")
      ?.conversion?.accounts.flatMap((account) => account.rates);

    expect(juneRates).toContainEqual(
      expect.objectContaining({ carriedForward: true }),
    );
    expect(septemberRates).toContainEqual(
      expect.objectContaining({ method: "triangulated" }),
    );
    expect(decemberRates).toContainEqual(
      expect.objectContaining({
        observationId: "gbp-usd-2024-12-01-corrected",
      }),
    );
    expect(decemberRates).not.toContainEqual(
      expect.objectContaining({
        observationId: "gbp-usd-2024-12-01-original",
      }),
    );
  });

  it("includes a converted recurring contribution with a fee", () => {
    const data = getDemoAssetTrackerData();

    expect(data.recurringFlows).toContainEqual(
      expect.objectContaining({
        id: "us-brokerage-contribution",
        amount: 300,
        currency: "GBP",
        conversion: {
          received: { amount: 380, currency: "USD" },
          fee: { amount: 2, currency: "GBP" },
          provider: "Wise",
        },
      }),
    );

    const repository = buildRepository(data);
    const sankey = buildBaseCurrencyFlowSankeyData(
      repository,
      getAllAccountDetails(repository),
      "2024-12-01",
    );
    expect(sankey.nodes).toContainEqual(
      expect.objectContaining({ name: "Wise" }),
    );
    expect(sankey.links).toContainEqual(
      expect.objectContaining({ label: "Conversion fee and spread" }),
    );
  });

  it("shows the demo tax position in the capital-flow map", () => {
    const data = getDemoAssetTrackerData();
    if (data.taxPosition == null) throw new Error("Expected demo tax records");
    const repository = buildRepository(data);
    const sankey = buildBaseCurrencyFlowSankeyData(
      repository,
      getAllAccountDetails(repository),
      "2024-12-01",
      {
        estimate: getHouseholdTaxEstimate(data),
        records: data.taxPosition,
      },
    );
    const links = sankey.links.map(
      ({ label, sourceName, targetName, value }) => ({
        label,
        sourceName,
        targetName,
        value,
      }),
    );

    expect(sankey.taxYear).toBe("2026-27");
    expect(links).toEqual(
      expect.arrayContaining([
        {
          label: "Gross salary",
          sourceName: "External income",
          targetName: "Gross pay",
          value: 8333.33,
        },
        {
          label: "Estimated Income Tax and National Insurance",
          sourceName: "Gross pay",
          targetName: "Tax and deductions",
          value: 1698,
        },
        {
          label: "Estimated savings interest tax",
          sourceName: "Marcus Savings",
          targetName: "Tax and deductions",
          value: 8.33,
        },
        {
          label: "Estimated Dividend Tax",
          sourceName: "Vanguard Global All Cap",
          targetName: "Tax and deductions",
          value: 20.85,
        },
        {
          label: "Estimated Capital Gains Tax",
          sourceName: "Coinbase BTC",
          targetName: "Tax and deductions",
          value: 40,
        },
        {
          label: "ISA contribution",
          sourceName: "Nationwide Current",
          targetName: "Trading 212 ISA",
          value: 500,
        },
        {
          label: "Pension contribution",
          sourceName: "Nationwide Current",
          targetName: "Workplace Pension",
          value: 666.67,
        },
        {
          label: "Pension tax relief",
          sourceName: "External income",
          targetName: "Workplace Pension",
          value: 166.67,
        },
      ]),
    );
  });
});

function conversionAccount(
  accountName: string,
  nativeValue: number,
  nativeCurrency: "GBP" | "USD" | "EUR",
  convertedValue: number,
) {
  return {
    accountId: accountName.toLowerCase().replaceAll(" ", "-"),
    accountName,
    nativeValue,
    nativeCurrency,
    convertedValue,
    rates: [],
    issues: [],
  };
}
