import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  type HousingValue,
  HousingValueSchema,
  indicativeRange,
} from "finance-housing-indices/browser";
import { describe, expect, it } from "vitest";
import { HousingValueDisclosure } from "@/app/_projects/personal-finance-app/components/housing-value-disclosure";

const exactGeography = {
  name: "10 Example Street, Cardiff",
  code: "CF10 1AA",
  precision: "exact-property" as const,
};

function value(candidate: Parameters<typeof HousingValueSchema.parse>[0]) {
  return HousingValueSchema.parse(candidate);
}

const revisedFallbackEstimate = value({
  id: "revised-fallback",
  kind: "index-estimate",
  amount: 320_000,
  currency: "GBP",
  asOf: "2024-01-31",
  source: {
    kind: "official-index",
    name: "HM Land Registry UK House Price Index",
    date: "2026-09-16",
    dateKind: "published",
    geography: {
      name: "Cardiff",
      code: "W06000015",
      precision: "local-authority",
    },
  },
  dataStatus: "revised",
  revisionNote: "The official source revised this observation.",
  uncertainty: indicativeRange(
    320_000,
    0.08,
    "The range is plus or minus 8% of the index estimate.",
  ),
  fallback: {
    used: true,
    explanation:
      "The regional all-property series replaced the missing local series.",
  },
  explanation: "Area index movement is not an individual property appraisal.",
  freshness: { assessedAt: "2026-10-30", staleAfterDays: 180 },
});

function pointValue(
  overrides: Pick<
    HousingValue,
    "id" | "kind" | "amount" | "asOf" | "source" | "explanation"
  >,
): HousingValue {
  return value({
    ...overrides,
    currency: "GBP",
    dataStatus: "final",
    uncertainty: {
      kind: "point",
      explanation: "This amount has no modelled confidence interval.",
    },
    freshness: { assessedAt: "2026-10-30", staleAfterDays: 365 },
  });
}

const manualOverride = pointValue({
  id: "manual",
  kind: "manual-override",
  amount: 335_000,
  asOf: "2026-10-01",
  source: {
    kind: "manual-entry",
    name: "Owner override",
    date: "2026-10-02",
    dateKind: "entered",
    geography: exactGeography,
  },
  explanation:
    "A manual override is user-entered and is not independent evidence.",
});

const askingPrice = pointValue({
  id: "asking",
  kind: "asking-price",
  amount: 350_000,
  asOf: "2026-10-15",
  source: {
    kind: "property-listing",
    name: "Seller listing",
    date: "2026-10-16",
    dateKind: "retrieved",
    geography: exactGeography,
  },
  explanation: "An asking price is neither a completed sale nor a valuation.",
});

const completedSale = pointValue({
  id: "sale",
  kind: "completed-sale",
  amount: 327_500,
  asOf: "2026-09-12",
  source: {
    kind: "official-completed-sale",
    name: "HM Land Registry Price Paid Data",
    date: "2026-10-20",
    dateKind: "retrieved",
    geography: { ...exactGeography, precision: "full-postcode" },
  },
  explanation:
    "A completed sale is evidence, not the current value of another home.",
});

const forecast = pointValue({
  id: "forecast",
  kind: "forecast",
  amount: 372_000,
  asOf: "2031-10-30",
  source: {
    kind: "scenario-model",
    name: "Keep-home scenario at 3% annual growth",
    date: "2026-10-30",
    dateKind: "recorded",
    geography: exactGeography,
  },
  explanation:
    "A future scenario is a planning output, not a current valuation.",
});

describe("HousingValueDisclosure", () => {
  it("shows stale, revised, fallback, provenance, and the index range rule", async () => {
    const user = userEvent.setup();
    render(<HousingValueDisclosure value={revisedFallbackEstimate} />);

    expect(screen.getByText("Index estimate")).toBeVisible();
    expect(screen.getByText("Revised")).toBeVisible();
    expect(screen.getByText("Fallback")).toBeVisible();
    expect(screen.getByText("Stale")).toBeVisible();
    expect(screen.getByText("£320,000.00")).toBeVisible();
    expect(
      screen.getByText(/Indicative range £294,400.00 to £345,600.00/),
    ).toBeVisible();
    expect(screen.getByText("2024-01-31")).toBeVisible();
    expect(
      screen.getByText(
        /Official index · HM Land Registry UK House Price Index/,
      ),
    ).toBeVisible();
    expect(screen.getByText(/Cardiff · local authority/)).toBeVisible();
    expect(screen.getByText("2026-09-16")).toBeVisible();

    await user.click(screen.getByText("Why this number is shown"));
    expect(
      screen.getByText(/not an individual property appraisal/),
    ).toBeVisible();
    expect(screen.getByText(/plus or minus 8%/)).toBeVisible();
    expect(screen.getByText(/official source revised/)).toBeVisible();
    expect(screen.getByText(/Fallback rule/)).toBeVisible();
    expect(screen.getByText(/stale after 180 days/)).toBeVisible();
  });

  it("keeps manual, asking, completed-sale, and forecast explanations distinct", async () => {
    const user = userEvent.setup();
    render(
      <div>
        {[manualOverride, askingPrice, completedSale, forecast].map((item) => (
          <HousingValueDisclosure key={item.id} value={item} />
        ))}
      </div>,
    );

    for (const [label, explanation] of [
      ["Manual override", /user-entered and is not independent evidence/],
      ["Asking price", /neither a completed sale nor a valuation/],
      ["Completed sale", /not the current value of another home/],
      ["Future scenario", /planning output, not a current valuation/],
    ] as const) {
      const disclosure = screen.getByLabelText(`${label} evidence`);
      await user.click(
        within(disclosure).getByText("Why this number is shown"),
      );
      expect(within(disclosure).getByText(explanation)).toBeVisible();
    }
    expect(screen.getByText(/Property listing · Seller listing/)).toBeVisible();
    expect(
      screen.getByText(
        /Official completed-sale record · HM Land Registry Price Paid Data/,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/Scenario model · Keep-home scenario/),
    ).toBeVisible();
  });
});
