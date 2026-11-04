import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PropertyValueHistory } from "@/app/_projects/personal-finance-app/components/property-value-history";
import {
  housePriceIndexArchive,
  propertyIndexHistories,
} from "@/app/_projects/personal-finance-app/content/propertyIndexHistory";
import { buildPropertyValueHistoryViews } from "@/app/_projects/personal-finance-app/domain/propertyIndexHistory";

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

    const { container } = render(
      <PropertyValueHistory onSelectionChange={vi.fn()} view={view} />,
    );

    expect(screen.getByText("Indexed property history")).toBeVisible();
    expect(screen.getByText("Fallback series")).toBeVisible();
    expect(
      screen.getByText("Property-type fallback: Belfast, all"),
    ).toBeVisible();
    expect(screen.getByText("Latest index estimate")).toBeVisible();
    expect(screen.getAllByText("£322,905.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Recorded valuation").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2024-12-01").length).toBeGreaterThan(0);
    expect(screen.getAllByText("£298,000.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/^Indicative range £/)).toBeVisible();
    expect(screen.getAllByText("Stale").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        /Official index · HM Land Registry UK House Price Index/,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Belfast · local authority/).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/HM Land Registry · release 2026-07/),
    ).toBeVisible();
    expect(
      screen.getByText(/Published 2026-09-16 · retrieved 2026-10-04/),
    ).toBeVisible();
    expect(screen.getByText("Calculation details")).toBeVisible();
    expect(container.querySelector('[data-series="estimate"]')).toBeVisible();
    expect(container.querySelector('[data-series="recorded"]')).toBeVisible();
  });

  it("shows a pinned-release failure", () => {
    const view = buildPropertyValueHistoryViews(propertyIndexHistories, {
      releases: [],
    })[0];
    if (view == null)
      throw new Error("Missing unavailable property history view");
    render(<PropertyValueHistory onSelectionChange={vi.fn()} view={view} />);

    expect(screen.getByText("Unavailable")).toBeVisible();
    expect(screen.getByText(/UK HPI release .* is unavailable/)).toBeVisible();
    expect(
      screen.getByText(`Dataset ${propertyIndexHistories[0]?.datasetVersion}`),
    ).toBeVisible();
  });

  it("saves anchor changes and lets the user turn automatic estimates off", async () => {
    const onSelectionChange = vi.fn().mockResolvedValue(undefined);
    const view = buildPropertyValueHistoryViews(
      propertyIndexHistories,
      housePriceIndexArchive,
    )[0];
    if (view == null) throw new Error("Missing demo property history view");
    render(
      <PropertyValueHistory
        onSelectionChange={onSelectionChange}
        view={view}
      />,
    );

    expect(screen.getByText("Value used in net worth")).toBeVisible();
    expect(
      screen.getByText(
        /latest available index estimate from the selected anchor/,
      ),
    ).toBeVisible();
    await userEvent.selectOptions(
      screen.getByLabelText("Property estimate anchor"),
      "home-formal-valuation-2024-12",
    );
    expect(onSelectionChange).toHaveBeenCalledWith({
      accountId: "home",
      anchorValuationId: "home-formal-valuation-2024-12",
      valueSelection: { mode: "automatic-index" },
    });

    await userEvent.click(
      screen.getByRole("checkbox", { name: /Automatic estimate/ }),
    );
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      accountId: "home",
      anchorValuationId: "home-purchase-2023-03",
      valueSelection: {
        mode: "recorded-value",
        valuationId: "home-purchase-2023-03",
      },
    });
  });
});
