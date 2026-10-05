import { describe, expect, it } from "vitest";
import {
  type ComparableSalesQuery,
  findComparableSales,
  ingestPricePaidRelease,
  selectPricePaidRelease,
} from "../src/comparables";
import { parsePricePaidCsv } from "../src/pricePaid";
import { pricePaidCsv, pricePaidSource } from "./fixtures";

const release = parsePricePaidCsv(
  pricePaidSource,
  pricePaidCsv,
  "2026-10-04T12:00:00.000Z",
);

const query = {
  nation: "wales" as const,
  postcode: "cf10 9zz",
  completedFrom: "2026-01-01",
  completedTo: "2026-08-31",
  propertyTypes: ["detached", "semi-detached"],
  tenures: ["freehold", "leasehold"],
  newBuild: "include" as const,
  maxResults: 10,
} satisfies ComparableSalesQuery;

describe("completed-sale comparables", () => {
  it("matches deterministically and exposes its area, filters, and source", () => {
    const result = findComparableSales(release, query);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected comparables");
    expect(result.criteria).toEqual({
      searchArea: {
        kind: "postcode-district",
        value: "CF10",
        label: "CF10 postcode district",
      },
      completedFrom: "2026-01-01",
      completedTo: "2026-08-31",
      propertyTypes: ["detached", "semi-detached"],
      tenures: ["freehold", "leasehold"],
      newBuild: "include",
      maxResults: 10,
      matchingRule:
        "Exact postcode district, inclusive completion dates, selected property types, tenure, and new-build filter. Newest completions appear first.",
    });
    expect(result.sales.map(({ transactionId }) => transactionId)).toEqual([
      "tx-2",
      "tx-1",
    ]);
    expect(result.sales[0]).toMatchObject({
      price: 340_000,
      completionDate: "2026-08-05",
      propertyType: "semi-detached",
      tenure: "leasehold",
      newBuild: true,
      location: {
        postcode: "CF10 2BB",
        townCity: "CARDIFF",
        precision: "full-postcode",
      },
    });
    expect(result.evidence).toMatchObject({
      provider: "HM Land Registry",
      dataset: "Price Paid Data",
      retrievedAt: "2026-10-04T12:00:00.000Z",
      latestCompleteMonth: "2026-06",
    });
    expect(result.evidence.registrationLag).toContain("two weeks to two months");
    expect(result.evidence.recentDataWarning).toContain("incomplete");
  });

  it("returns an empty result without widening the search", () => {
    const result = findComparableSales(release, {
      ...query,
      propertyTypes: ["flat-maisonette"],
    });

    expect(result).toMatchObject({
      status: "empty",
      sales: [],
      criteria: { searchArea: { value: "CF10" } },
      message:
        "No completed sales matched this postcode district, date range, and property filter.",
    });
  });

  it.each(["scotland", "northern-ireland"] as const)(
    "reports %s as unsupported instead of implying equivalent coverage",
    (nation) => {
      expect(findComparableSales(release, { ...query, nation })).toMatchObject({
        status: "unsupported-region",
        nation,
        message: expect.stringContaining("not available"),
      });
    },
  );

  it("pins releases by version and ignores an unchanged import", () => {
    const archive = ingestPricePaidRelease({ releases: [] }, release);

    expect(ingestPricePaidRelease(archive, release)).toEqual(archive);
    expect(selectPricePaidRelease(archive, release.versionId)).toEqual(release);
    expect(() => selectPricePaidRelease(archive, "missing")).toThrow(
      "Price Paid Data release missing is unavailable",
    );
  });
});
