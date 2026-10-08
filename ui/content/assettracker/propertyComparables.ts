import type { PricePaidArchive } from "finance-housing-indices/browser";
import type { PropertyComparableSearchDefinition } from "@/lib/domain/assettracker/propertyComparables";
import { DEMO_UK_HPI_VERSION } from "./propertyIndexHistory";

export const DEMO_PRICE_PAID_VERSION = "2026-08:bbbbbbbbbbbb";

export const pricePaidArchive: PricePaidArchive = {
  releases: [
    {
      versionId: DEMO_PRICE_PAID_VERSION,
      source: {
        provider: "HM Land Registry",
        dataset: "Price Paid Data",
        releasePeriod: "2026-08",
        publishedAt: "2026-10-01",
        retrievedAt: "2026-10-04T12:00:00.000Z",
        pageUrl:
          "https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads",
        downloadUrl:
          "https://price-paid-data.publicdata.landregistry.gov.uk/pp-2026.csv",
        coverage: "england-and-wales",
        observedThrough: "2026-08-31",
        latestCompleteMonth: "2026-06",
        checksum: `sha256:${"b".repeat(64)}`,
        rawObjectKey: `price-paid/releases/${"b".repeat(64)}.csv`,
        licence: "Open Government Licence v3.0",
        attribution:
          "Contains HM Land Registry data © Crown copyright and database right 2021. This data is licensed under the Open Government Licence v3.0.",
      },
      transactions: [
        {
          transactionId: "demo-cardiff-2026-08",
          price: 340_000,
          completionDate: "2026-08-05",
          postcode: "CF10 2BB",
          propertyType: "semi-detached",
          newBuild: true,
          tenure: "leasehold",
          townCity: "Cardiff",
          district: "Cardiff",
          county: "Cardiff",
          recordStatus: "added",
        },
        {
          transactionId: "demo-cardiff-2026-06",
          price: 315_000,
          completionDate: "2026-06-18",
          postcode: "CF10 1AA",
          propertyType: "detached",
          newBuild: false,
          tenure: "freehold",
          townCity: "Cardiff",
          district: "Cardiff",
          county: "Cardiff",
          recordStatus: "added",
        },
        {
          transactionId: "demo-cardiff-2026-03",
          price: 307_500,
          completionDate: "2026-03-12",
          postcode: "CF10 4DD",
          propertyType: "semi-detached",
          newBuild: false,
          tenure: "freehold",
          townCity: "Cardiff",
          district: "Cardiff",
          county: "Cardiff",
          recordStatus: "added",
        },
        {
          transactionId: "demo-cardiff-other-district",
          price: 290_000,
          completionDate: "2026-05-09",
          postcode: "CF11 3CC",
          propertyType: "detached",
          newBuild: false,
          tenure: "freehold",
          townCity: "Cardiff",
          district: "Cardiff",
          county: "Cardiff",
          recordStatus: "added",
        },
      ],
    },
  ],
};

export const propertyComparableSearches: PropertyComparableSearchDefinition[] =
  [
    {
      accountId: "home",
      datasetVersion: DEMO_PRICE_PAID_VERSION,
      query: {
        nation: "northern-ireland",
        postcode: "BT1 1AA",
        completedFrom: "2024-09-01",
        completedTo: "2026-08-31",
        propertyTypes: ["detached", "semi-detached"],
        tenures: ["freehold", "leasehold"],
        newBuild: "include",
        maxResults: 8,
      },
      marketTrend: {
        datasetVersion: DEMO_UK_HPI_VERSION,
        query: {
          nation: "northern-ireland",
          seriesHierarchy: [
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
    },
    {
      accountId: "cardiff-property",
      datasetVersion: DEMO_PRICE_PAID_VERSION,
      query: {
        nation: "wales",
        postcode: "CF10 1ZZ",
        completedFrom: "2024-09-01",
        completedTo: "2026-08-31",
        propertyTypes: ["detached", "semi-detached"],
        tenures: ["freehold", "leasehold"],
        newBuild: "include",
        maxResults: 8,
      },
    },
  ];
