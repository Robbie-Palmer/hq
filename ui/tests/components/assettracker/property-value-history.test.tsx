import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PropertyValueHistory } from "@/components/assettracker/property-value-history";
import {
  housePriceIndexArchive,
  propertyIndexHistories,
} from "@/content/assettracker/propertyIndexHistory";
import { buildPropertyValueHistoryViews } from "@/lib/domain/assettracker/propertyIndexHistory";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Line: ({ dataKey }: { dataKey: string }) => <div data-series={dataKey} />,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Legend: () => null,
  Tooltip: () => null,
}));

describe("PropertyValueHistory", () => {
  it("shows estimates, recorded valuations, fallback, and provenance", () => {
    const view = buildPropertyValueHistoryViews(
      propertyIndexHistories,
      housePriceIndexArchive,
    )[0];
    if (view == null) throw new Error("Missing demo property history view");

    const { container } = render(<PropertyValueHistory view={view} />);

    expect(screen.getByText("Indexed property history")).toBeVisible();
    expect(screen.getByText("Fallback series")).toBeVisible();
    expect(
      screen.getByText("Property-type fallback: Belfast, all"),
    ).toBeVisible();
    expect(screen.getByText("Latest index estimate")).toBeVisible();
    expect(screen.getAllByText("£322,905.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/Formal valuation · 2024-12-01/)).toBeVisible();
    expect(screen.getAllByText("£298,000.00").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/HM Land Registry · release 2026-07/),
    ).toBeVisible();
    expect(screen.getByText("Calculation details")).toBeVisible();
    expect(container.querySelector('[data-series="estimate"]')).toBeVisible();
    expect(container.querySelector('[data-series="recorded"]')).toBeVisible();
  });

  it("shows a pinned-release failure", () => {
    render(
      <PropertyValueHistory
        view={{
          status: "unavailable",
          accountId: "home",
          datasetVersion: "missing-release",
          message: "The saved UK HPI release is unavailable.",
        }}
      />,
    );

    expect(screen.getByText("Unavailable")).toBeVisible();
    expect(
      screen.getByText("The saved UK HPI release is unavailable."),
    ).toBeVisible();
    expect(screen.getByText("Dataset missing-release")).toBeVisible();
  });
});
