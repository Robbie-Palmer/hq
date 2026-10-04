import { describe, expect, it } from "vitest";
import {
  housePriceIndexArchive,
  propertyIndexHistories,
} from "@/content/assettracker/propertyIndexHistory";
import { buildPropertyValueHistoryViews } from "@/lib/domain/assettracker/propertyIndexHistory";

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
    });
  });
});
