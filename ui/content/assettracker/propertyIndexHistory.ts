import type { HousePriceIndexArchive } from "finance-housing-indices";
import type { PropertyIndexHistoryDefinition } from "@/lib/domain/assettracker/propertyIndexHistory";

export const DEMO_UK_HPI_VERSION = "2026-07:654a541934ba";

export const housePriceIndexArchive: HousePriceIndexArchive = {
  releases: [
    {
      versionId: DEMO_UK_HPI_VERSION,
      source: {
        provider: "HM Land Registry",
        dataset: "UK House Price Index",
        releasePeriod: "2026-07",
        publishedAt: "2026-09-16",
        retrievedAt: "2026-10-04T12:00:00.000Z",
        pageUrl:
          "https://www.gov.uk/government/statistical-data-sets/uk-house-price-index-data-downloads-july-2026",
        downloadUrl:
          "https://publicdata.landregistry.gov.uk/market-trend-data/house-price-index-data/UK-HPI-full-file-2026-07.csv",
        checksum:
          "sha256:654a541934ba7b393a741e23bc0c6fb668690f562feb8a7b4fff62d653fd6607",
        rawObjectKey:
          "uk-hpi/releases/654a541934ba7b393a741e23bc0c6fb668690f562feb8a7b4fff62d653fd6607.csv",
        licence: "Open Government Licence v3.0",
        attribution:
          "Contains HM Land Registry data © Crown copyright and database right 2026. Licensed under the Open Government Licence v3.0.",
      },
      observations: [
        ["2023-03", 100, 149_391, 358],
        ["2023-06", 99.7, 148_990, 338],
        ["2023-09", 104.8, 156_540, 416],
        ["2023-12", 102.6, 153_230, 368],
        ["2024-03", 103.7, 154_921, 307],
        ["2024-06", 106, 158_406, 371],
        ["2024-09", 112, 167_277, 421],
        ["2024-12", 113.3, 169_319, 420],
        ["2025-03", 113.8, 170_049, 450],
        ["2025-06", 114.9, 171_606, 303],
        ["2025-09", 119, 177_759, 399],
        ["2025-12", 119.7, 178_802, 452],
        ["2026-03", 121.4, 181_424, 374],
        ["2026-06", 123.7, 184_768],
      ].map(([period, index, averagePrice, salesVolume]) => ({
        period: String(period),
        geographyCode: "N09000003",
        geographyName: "Belfast",
        propertyType: "all" as const,
        index: Number(index),
        averagePrice: Number(averagePrice),
        ...(salesVolume == null ? {} : { salesVolume: Number(salesVolume) }),
        provisional: String(period) >= "2025-09",
      })),
    },
  ],
};

export const propertyIndexHistories: PropertyIndexHistoryDefinition[] = [
  {
    accountId: "home",
    datasetVersion: DEMO_UK_HPI_VERSION,
    input: {
      recordedValuations: [
        {
          id: "home-purchase-2023-03",
          date: "2023-03-01",
          value: 285_000,
          currency: "GBP",
          kind: "purchase-price",
          sourceLabel: "Recorded purchase price",
        },
        {
          id: "home-formal-valuation-2024-12",
          date: "2024-12-01",
          value: 298_000,
          currency: "GBP",
          kind: "formal-valuation",
          sourceLabel: "Mortgage valuation",
        },
      ],
      anchorValuationId: "home-purchase-2023-03",
      targetDates: [
        "2023-03-01",
        "2023-06-01",
        "2023-09-01",
        "2023-12-01",
        "2024-03-01",
        "2024-06-01",
        "2024-09-01",
        "2024-12-01",
      ],
      seriesHierarchy: [
        {
          geographyCode: "N09000003",
          propertyType: "detached",
          geographyMatch: "exact",
          propertyTypeMatch: "exact",
        },
        {
          geographyCode: "N09000003",
          propertyType: "all",
          geographyMatch: "exact",
          propertyTypeMatch: "all",
        },
        {
          geographyCode: "N92000002",
          propertyType: "all",
          geographyMatch: "national",
          propertyTypeMatch: "all",
        },
      ],
    },
  },
];
