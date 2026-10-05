import { describe, expect, it } from "vitest";
import {
  findNorthernIrelandMarketTrend,
  type HousePriceIndexRelease,
} from "../src";

const release: HousePriceIndexRelease = {
  versionId: "2026-07:fixture",
  source: {
    provider: "HM Land Registry",
    dataset: "UK House Price Index",
    releasePeriod: "2026-07",
    publishedAt: "2026-09-16",
    retrievedAt: "2026-10-04T12:00:00.000Z",
    pageUrl: "https://www.gov.uk/government/example",
    downloadUrl: "https://publicdata.landregistry.gov.uk/example.csv",
    checksum: `sha256:${"a".repeat(64)}`,
    rawObjectKey: `uk-hpi/releases/${"a".repeat(64)}.csv`,
    licence: "Open Government Licence v3.0",
    attribution: "Contains official UK HPI data.",
  },
  observations: [
    {
      period: "2025-06",
      geographyCode: "N09000003",
      geographyName: "Belfast",
      propertyType: "all",
      averagePrice: 171_606,
      salesVolume: 303,
      index: 114.9,
      provisional: false,
    },
    {
      period: "2026-03",
      geographyCode: "N09000003",
      geographyName: "Belfast",
      propertyType: "all",
      averagePrice: 181_424,
      salesVolume: 374,
      index: 121.4,
      provisional: true,
    },
    {
      period: "2026-06",
      geographyCode: "N09000003",
      geographyName: "Belfast",
      propertyType: "all",
      averagePrice: 184_768,
      index: 123.7,
      provisional: true,
    },
  ],
};

describe("Northern Ireland HPI market trends", () => {
  it("selects the latest quarter and keeps sales-volume timing explicit", () => {
    const result = findNorthernIrelandMarketTrend(release, {
      nation: "northern-ireland",
      seriesHierarchy: [
        {
          geographyCode: "N09000003",
          propertyType: "all",
          geographyMatch: "exact",
          propertyTypeMatch: "all",
        },
      ],
    });

    expect(result).toMatchObject({
      geographyName: "Belfast",
      propertyType: "all",
      period: "2026-06",
      averagePrice: 184_768,
      provisional: true,
      reportedSalesVolume: {
        count: 374,
        period: "2026-03",
        propertyType: "all",
      },
      evidence: {
        provider: "Land & Property Services / NISRA",
        dataset: "Northern Ireland House Price Index",
      },
    });
    expect(result.annualChangePercent).toBeCloseTo(7.66, 2);
  });

  it("fails instead of substituting an unconfigured area", () => {
    expect(() =>
      findNorthernIrelandMarketTrend(release, {
        nation: "northern-ireland",
        seriesHierarchy: [
          {
            geographyCode: "N09000011",
            propertyType: "all",
            geographyMatch: "exact",
            propertyTypeMatch: "all",
          },
        ],
      }),
    ).toThrow("no Northern Ireland observation");
  });
});
