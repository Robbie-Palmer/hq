import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PropertyComparables } from "@/components/assettracker/property-comparables";
import {
  DEMO_PRICE_PAID_VERSION,
  pricePaidArchive,
  propertyComparableSearches,
} from "@/content/assettracker/propertyComparables";
import { housePriceIndexArchive } from "@/content/assettracker/propertyIndexHistory";
import { buildPropertyComparableViews } from "@/lib/domain/assettracker/propertyComparables";

describe("PropertyComparables", () => {
  it("shows completed sales, search rules, lag, and provenance", () => {
    const view = buildPropertyComparableViews(
      propertyComparableSearches.map((definition) => ({
        ...definition,
        query: {
          ...definition.query,
          nation: "wales" as const,
          postcode: "CF10 1ZZ",
        },
      })),
      pricePaidArchive,
      housePriceIndexArchive,
    )[0];
    if (view == null) throw new Error("Missing demo comparable-sales view");

    render(<PropertyComparables view={view} />);

    expect(screen.getByText("Recent completed sales")).toBeVisible();
    expect(screen.getByText("3 matches")).toBeVisible();
    expect(screen.getByText("CF10 postcode district")).toBeVisible();
    expect(screen.getAllByText("£340,000.00").length).toBeGreaterThan(0);
    expect(screen.getByText("5 Aug 2026")).toBeVisible();
    const table = screen.getByRole("table", {
      name: "Recent completed-sale comparables",
    });
    expect(within(table).getAllByText("Semi-detached").length).toBeGreaterThan(
      0,
    );
    expect(within(table).getByText(/Leasehold · New build/)).toBeVisible();
    expect(screen.getByText("CF10 2BB")).toBeVisible();
    expect(
      within(table).getAllByText(/Cardiff · full postcode/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/two weeks to two months/)).toBeVisible();
    expect(
      screen.getByText(/Records after 2026-06 are incomplete/),
    ).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: "HM Land Registry Price Paid Data",
      }),
    ).toHaveAttribute(
      "href",
      "https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads",
    );
    expect(screen.getByText("Matching rules")).toBeVisible();
  });

  it("shows an empty result without claiming a wider search", () => {
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
            propertyTypes: ["flat-maisonette"],
          },
        },
      ],
      pricePaidArchive,
      housePriceIndexArchive,
    )[0];
    if (view == null) throw new Error("Missing empty comparable-sales view");

    render(<PropertyComparables view={view} />);

    expect(screen.getByText("0 matches")).toBeVisible();
    expect(screen.getByText(/No completed sales matched/)).toBeVisible();
    expect(screen.getByText(/not widened automatically/)).toBeVisible();
  });

  it("explains unsupported UK regions", () => {
    const definition = propertyComparableSearches[0];
    if (definition == null) throw new Error("Missing demo search");
    const view = buildPropertyComparableViews(
      [
        {
          ...definition,
          query: { ...definition.query, nation: "scotland" },
        },
      ],
      pricePaidArchive,
      housePriceIndexArchive,
    )[0];
    if (view == null) throw new Error("Missing unsupported-region view");

    render(<PropertyComparables view={view} />);

    expect(screen.getByText("Unsupported region")).toBeVisible();
    expect(
      screen.getByText(/completed-sale records for Scotland/),
    ).toBeVisible();
  });

  it("shows NI HPI evidence without presenting it as comparable sales", () => {
    const view = buildPropertyComparableViews(
      propertyComparableSearches,
      pricePaidArchive,
      housePriceIndexArchive,
    )[0];
    if (view == null) throw new Error("Missing Northern Ireland evidence view");

    render(<PropertyComparables view={view} />);

    expect(screen.getByText("No open sales records")).toBeVisible();
    expect(
      screen.getByText(
        /Individual completed-sale records for Northern Ireland/,
      ),
    ).toBeVisible();
    expect(screen.getByText("Area market trend")).toBeVisible();
    expect(screen.getByText("NI HPI")).toBeVisible();
    expect(
      screen.getByText(/Belfast · All property types · Q2 2026/),
    ).toBeVisible();
    expect(screen.getByText("£184,768.00")).toBeVisible();
    expect(screen.getByText("+7.7%")).toBeVisible();
    expect(
      screen.getByText("374 in Q1 2026 · all property types"),
    ).toBeVisible();
    expect(
      screen.getByText(/do not identify individual properties/),
    ).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: "Land & Property Services / NISRA Northern Ireland House Price Index",
      }),
    ).toHaveAttribute(
      "href",
      "https://www.finance-ni.gov.uk/articles/northern-ireland-house-price-index",
    );
  });

  it("shows a pinned-release failure", () => {
    render(
      <PropertyComparables
        view={{
          status: "unavailable",
          accountId: "home",
          datasetVersion: DEMO_PRICE_PAID_VERSION,
          message: "The saved Price Paid Data release is unavailable.",
        }}
      />,
    );

    expect(screen.getByText("Unavailable")).toBeVisible();
    expect(
      screen.getByText("The saved Price Paid Data release is unavailable."),
    ).toBeVisible();
  });
});
