import {
  type HousingValue,
  HousingValueSchema,
  indicativeRange,
  type UnsupportedHousingRegion,
} from "../src";

const exactGeography = {
  name: "10 Example Street, Cardiff",
  code: "CF10 1AA",
  precision: "exact-property" as const,
};

function value(
  candidate: Parameters<typeof HousingValueSchema.parse>[0],
): HousingValue {
  return HousingValueSchema.parse(candidate);
}

export const staleIndexEstimate = value({
  id: "fixture-stale-index",
  kind: "index-estimate",
  amount: 320_000,
  currency: "GBP",
  asOf: "2024-01-31",
  source: {
    kind: "official-index",
    name: "HM Land Registry UK House Price Index",
    date: "2024-03-20",
    dateKind: "published",
    geography: {
      name: "Cardiff",
      code: "W06000015",
      precision: "local-authority",
    },
  },
  dataStatus: "final",
  uncertainty: indicativeRange(
    320_000,
    0.08,
    "Indicative range is plus or minus 8% of the index estimate.",
  ),
  explanation: "Area index movement is not an individual property appraisal.",
  freshness: { assessedAt: "2026-10-30", staleAfterDays: 180 },
});

export const revisedFallbackIndexEstimate = value({
  ...staleIndexEstimate,
  id: "fixture-revised-fallback-index",
  asOf: "2026-08-31",
  dataStatus: "revised",
  revisionNote: "The official source revised the August observation.",
  fallback: {
    used: true,
    explanation: "The local detached series was unavailable, so the regional all-property series was used.",
  },
});

export const manualOverrideValue = value({
  id: "fixture-manual-override",
  kind: "manual-override",
  amount: 335_000,
  currency: "GBP",
  asOf: "2026-10-01",
  source: {
    kind: "manual-entry",
    name: "Owner override",
    date: "2026-10-02",
    dateKind: "entered",
    geography: exactGeography,
  },
  dataStatus: "final",
  uncertainty: {
    kind: "point",
    explanation: "The user entered this amount without independent evidence.",
  },
  explanation: "A manual override is user-entered and does not become a recorded valuation.",
  freshness: { assessedAt: "2026-10-30", staleAfterDays: 90 },
});

export const askingPriceValue = value({
  id: "fixture-asking-price",
  kind: "asking-price",
  amount: 350_000,
  currency: "GBP",
  asOf: "2026-10-15",
  source: {
    kind: "property-listing",
    name: "Seller listing",
    date: "2026-10-16",
    dateKind: "retrieved",
    geography: exactGeography,
  },
  dataStatus: "final",
  uncertainty: {
    kind: "point",
    explanation: "The amount is the seller's requested price.",
  },
  explanation: "An asking price is neither a completed sale nor a valuation.",
  freshness: { assessedAt: "2026-10-30", staleAfterDays: 30 },
});

export const completedSaleValue = value({
  id: "fixture-completed-sale",
  kind: "completed-sale",
  amount: 327_500,
  currency: "GBP",
  asOf: "2026-09-12",
  source: {
    kind: "official-completed-sale",
    name: "HM Land Registry Price Paid Data",
    date: "2026-10-20",
    dateKind: "retrieved",
    geography: {
      ...exactGeography,
      precision: "full-postcode",
    },
  },
  dataStatus: "final",
  uncertainty: {
    kind: "point",
    explanation: "This is the registered consideration for one transaction.",
  },
  explanation: "A completed sale is evidence, not the current value of another home.",
  freshness: { assessedAt: "2026-10-30", staleAfterDays: 730 },
});

export const forecastValue = value({
  id: "fixture-forecast",
  kind: "forecast",
  amount: 372_000,
  currency: "GBP",
  asOf: "2031-10-30",
  source: {
    kind: "scenario-model",
    name: "Keep-home scenario at 3% annual growth",
    date: "2026-10-30",
    dateKind: "recorded",
    geography: exactGeography,
  },
  dataStatus: "final",
  uncertainty: {
    kind: "point",
    explanation: "The amount follows the named scenario assumptions.",
  },
  explanation: "A future scenario is a planning output, not a current valuation.",
  freshness: { assessedAt: "2026-10-30", staleAfterDays: 0 },
});

export const unsupportedScotland: UnsupportedHousingRegion = {
  status: "unsupported-region",
  geography: { name: "Scotland", precision: "nation" },
  sourceKind: "official-completed-sale",
  sourceName: "HM Land Registry Price Paid Data",
  retrievedAt: "2026-10-20",
  explanation: "This completed-sale source covers England and Wales only.",
};

export const confidenceFixtures = [
  staleIndexEstimate,
  revisedFallbackIndexEstimate,
  manualOverrideValue,
  askingPriceValue,
  completedSaleValue,
  forecastValue,
] as const;
