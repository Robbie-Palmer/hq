import { describe, expect, it } from "vitest";
import {
  housePriceIndexArchive,
  propertyIndexHistories,
} from "@/app/_projects/personal-finance-app/content/propertyIndexHistory";
import {
  applySetPropertyValueSelection,
  buildPropertyValueHistoryViews,
  buildRepository,
  getHousingPlanningPosition,
  getPortfolioFinancialIndependence,
  PropertyIndexHistoryDefinitionSchema,
  valueAccountAtDate,
  withSelectedPropertyValues,
} from "@/app/_projects/personal-finance-app/domain";
import { getDemoAssetTrackerData } from "@/app/_projects/personal-finance-app/lib";

describe("property index history views", () => {
  it("recalculates the seeded history from its pinned release", () => {
    const view = buildPropertyValueHistoryViews(
      propertyIndexHistories,
      housePriceIndexArchive,
    )[0];

    expect(view?.status).toBe("ready");
    if (view?.status !== "ready") {
      throw new Error("Expected the seeded property history to be available");
    }
    expect(view.history.calculation).toMatchObject({
      anchor: {
        id: "home-purchase-2023-03",
        value: 285_000,
        date: "2023-03-01",
      },
      series: {
        geographyCode: "N09000003",
        propertyType: "all",
        hierarchyPosition: 2,
        fallback: true,
        label: "Property-type fallback: Belfast, all",
      },
      dataset: {
        releasePeriod: "2026-07",
        versionId: "2026-07:654a541934ba",
      },
    });
    expect(view.history.estimates.at(-1)).toMatchObject({
      kind: "index-estimate",
      date: "2024-12-01",
      value: 322_905,
    });
    expect(view.history.recordedValuations.at(-1)).toMatchObject({
      kind: "formal-valuation",
      value: 298_000,
    });
    expect(view.selectedValue).toMatchObject({
      kind: "index-estimate",
      amount: 322_905,
      asOf: "2024-12-01",
    });
    expect(view.selectionExplanation).toMatch(
      /latest available index estimate/,
    );
  });

  it("uses a chosen recorded value when automatic estimates are off", () => {
    const definition = propertyIndexHistories[0];
    if (definition == null) throw new Error("Missing demo property history");
    const view = buildPropertyValueHistoryViews(
      [
        {
          ...definition,
          valueSelection: {
            mode: "recorded-value",
            valuationId: "home-formal-valuation-2024-12",
          },
        },
      ],
      housePriceIndexArchive,
    )[0];

    expect(view?.selectedValue).toMatchObject({
      id: "home-formal-valuation-2024-12",
      kind: "recorded-valuation",
      amount: 298_000,
    });
    expect(view?.selectionExplanation).toMatch(/Automatic estimates are off/);
  });

  it("reports a missing pinned release without dropping the property", () => {
    const definition = propertyIndexHistories[0];
    if (definition == null) throw new Error("Missing demo property history");

    expect(
      buildPropertyValueHistoryViews(
        [{ ...definition, datasetVersion: "missing-release" }],
        housePriceIndexArchive,
      )[0],
    ).toMatchObject({
      status: "unavailable",
      accountId: "home",
      datasetVersion: "missing-release",
      message: "UK HPI release missing-release is unavailable",
      selectedValue: {
        id: "home-purchase-2023-03",
        amount: 285_000,
      },
      selectionExplanation: expect.stringMatching(/recorded anchor value/),
    });
  });

  it("persists valid choices and rejects unknown anchors and recorded values", () => {
    const data = getDemoAssetTrackerData();
    const updated = applySetPropertyValueSelection(data, {
      accountId: "home",
      anchorValuationId: "home-formal-valuation-2024-12",
      valueSelection: {
        mode: "recorded-value",
        valuationId: "home-formal-valuation-2024-12",
      },
    });

    expect(updated.propertyIndexHistories?.[0]).toMatchObject({
      valueSelection: {
        mode: "recorded-value",
        valuationId: "home-formal-valuation-2024-12",
      },
      input: { anchorValuationId: "home-formal-valuation-2024-12" },
    });
    expect(() =>
      applySetPropertyValueSelection(data, {
        accountId: "home",
        anchorValuationId: "home-purchase-2023-03",
        valueSelection: {
          mode: "recorded-value",
          valuationId: "missing",
        },
      }),
    ).toThrow(/selected property valuation must be recorded/);
    expect(() =>
      applySetPropertyValueSelection(data, {
        accountId: "home",
        anchorValuationId: "missing",
        valueSelection: { mode: "automatic-index" },
      }),
    ).toThrow(/anchor valuation must be recorded/);

    const definition = propertyIndexHistories[0];
    if (definition == null) throw new Error("Missing demo property history");
    expect(
      PropertyIndexHistoryDefinitionSchema.safeParse({
        ...definition,
        input: { ...definition.input, anchorValuationId: "missing" },
      }).success,
    ).toBe(false);
  });

  it("feeds the selected value and its provenance into portfolio valuation", () => {
    const data = getDemoAssetTrackerData();
    const baseRepository = buildRepository(data);
    const views = buildPropertyValueHistoryViews(
      baseRepository.propertyIndexHistories,
      housePriceIndexArchive,
    );
    const repository = withSelectedPropertyValues(baseRepository, views);
    const account = repository.accounts.get("home");
    if (account == null) throw new Error("Missing demo home account");

    const valuation = valueAccountAtDate(repository, account, "2024-12-01");

    expect(valuation.nativeValue).toBe(322_905);
    expect(valuation.housingValue).toMatchObject({
      kind: "index-estimate",
      source: {
        kind: "official-index",
        name: "HM Land Registry UK House Price Index",
      },
      uncertainty: { kind: "indicative-range" },
    });
    const financialIndependence = getPortfolioFinancialIndependence(
      repository,
      "2024-12-01",
    );
    const housingPosition = getHousingPlanningPosition(
      repository,
      financialIndependence,
      "2024-12-01",
    );
    expect(housingPosition).toMatchObject({
      homeValue: 637_905,
      homeValueRange: {
        lower: 613_687.125,
        upper: 662_122.875,
      },
      propertyValueRanges: {
        home: { lower: 298_687.125, upper: 347_122.875 },
        "cardiff-property": { lower: 315_000, upper: 315_000 },
      },
      valuationBasis: [
        {
          id: "index-estimate:2024-12-01",
          source: { kind: "official-index" },
        },
      ],
    });
  });
});
