import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  buildRealIncomeHistorySeries,
  RealIncomeHistoryChart,
} from "@/components/assettracker/real-income-history-chart";
import type { InflationDatasetRelease } from "@/lib/domain/assettracker";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  LineChart: ({ children, data }: { children: ReactNode; data: unknown[] }) => (
    <div data-chart-data={JSON.stringify(data)} data-testid="income-chart">
      {children}
    </div>
  ),
  Line: ({ dataKey }: { dataKey: string }) => <div data-series={dataKey} />,
  CartesianGrid: () => null,
  Legend: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const release: InflationDatasetRelease = {
  versionId: "2025-03-19:aaaaaaaaaaaa",
  index: "CPIH",
  source: {
    provider: "Office for National Statistics",
    datasetId: "MM23",
    seriesId: "L522",
    frequency: "monthly",
    baseDefinition: "2015=100",
    geography: "United Kingdom",
    coverageFrom: "2025-01",
    coverageThrough: "2025-03",
    sourceUrl: "https://example.com/cpih",
    releaseVersion: "2025-03-19",
    retrievedAt: "2025-03-20T12:00:00.000Z",
    checksum: `sha256:${"a".repeat(64)}`,
  },
  observations: [
    { period: "2025-01", value: 100 },
    { period: "2025-02", value: 105 },
    { period: "2025-03", value: 110 },
  ],
};

describe("buildRealIncomeHistorySeries", () => {
  it("sorts income and restates it in the latest published CPIH period", () => {
    const series = buildRealIncomeHistorySeries(
      [
        { date: "2025-03-31", amount: 3_300, currency: "GBP" },
        { date: "2025-01-31", amount: 3_000, currency: "GBP" },
      ],
      release,
      "GBP",
    );

    expect(series).toEqual([
      {
        date: "2025-01-31",
        nominalIncome: 3_000,
        adjustedIncome: 3_300,
      },
      {
        date: "2025-03-31",
        nominalIncome: 3_300,
        adjustedIncome: 3_300,
      },
    ]);
  });

  it("keeps records outside CPIH coverage as nominal values", () => {
    expect(
      buildRealIncomeHistorySeries(
        [{ date: "2025-04-30", amount: 3_400, currency: "GBP" }],
        release,
        "GBP",
      ),
    ).toEqual([{ date: "2025-04-30", nominalIncome: 3_400 }]);
  });
});

describe("RealIncomeHistoryChart", () => {
  it("plots nominal and CPIH-adjusted income with a dataset disclosure", () => {
    render(
      <RealIncomeHistoryChart
        incomeHistory={[{ date: "2025-01-31", amount: 3_000, currency: "GBP" }]}
        release={release}
      />,
    );

    expect(
      screen.getByRole("img", {
        name: "Nominal and CPIH-adjusted income by period",
      }),
    ).toBeVisible();
    expect(screen.getAllByText("Nominal income").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CPIH-adjusted income").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText(/ONS 2025-03-19/)).toHaveTextContent(
      "dataset 2025-03-19:aaaaaaaaaaaa",
    );
  });

  it("provides an import action when income history is empty", () => {
    render(<RealIncomeHistoryChart incomeHistory={[]} release={release} />);

    expect(screen.getByText("No income history yet")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Import income history" }),
    ).toHaveAttribute("href", "/assettracker/imports");
  });

  it("explains records outside the published CPIH period", () => {
    render(
      <RealIncomeHistoryChart
        incomeHistory={[{ date: "2025-04-30", amount: 3_400, currency: "GBP" }]}
        release={release}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "CPIH adjustment is unavailable for these income records",
    );
  });
});
