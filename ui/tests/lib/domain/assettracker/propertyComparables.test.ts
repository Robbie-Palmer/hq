import { describe, expect, it } from "vitest";
import {
  pricePaidArchive,
  propertyComparableSearches,
} from "@/content/assettracker/propertyComparables";
import { housePriceIndexArchive } from "@/content/assettracker/propertyIndexHistory";
import { buildPropertyComparableViews } from "@/lib/domain/assettracker/propertyComparables";

describe("property comparable views", () => {
  it("adds pinned NI HPI evidence when individual sales are unavailable", () => {
    const view = buildPropertyComparableViews(
      propertyComparableSearches,
      pricePaidArchive,
      housePriceIndexArchive,
    )[0];

    expect(view).toMatchObject({
      status: "unsupported-region",
      accountId: "home",
      nation: "northern-ireland",
      marketTrend: {
        status: "ready",
        trend: {
          geographyName: "Belfast",
          propertyType: "all",
          period: "2026-06",
          averagePrice: 184_768,
          reportedSalesVolume: { count: 374, period: "2026-03" },
        },
      },
    });
  });

  it("matches an England or Wales search against the Price Paid release", () => {
    const definition = propertyComparableSearches[0];
    if (definition == null) throw new Error("Missing demo search");
    const view = buildPropertyComparableViews(
      [
        {
          ...definition,
          query: {
            ...definition.query,
            nation: "wales",
            postcode: "CF10 1ZZ",
          },
        },
      ],
      pricePaidArchive,
      housePriceIndexArchive,
    )[0];

    expect(view).toMatchObject({
      status: "ready",
      criteria: { searchArea: { value: "CF10" } },
      sales: expect.arrayContaining([
        expect.objectContaining({ transactionId: "demo-cardiff-2026-08" }),
      ]),
    });
  });

  it("reports a missing pinned release", () => {
    const definition = propertyComparableSearches[0];
    if (definition == null) throw new Error("Missing demo search");

    expect(
      buildPropertyComparableViews(
        [{ ...definition, datasetVersion: "missing-release" }],
        pricePaidArchive,
        housePriceIndexArchive,
      )[0],
    ).toMatchObject({
      status: "unavailable",
      accountId: "home",
      datasetVersion: "missing-release",
      message: "Price Paid Data release missing-release is unavailable",
    });
  });
});
