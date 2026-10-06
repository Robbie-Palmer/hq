import { fireEvent, render, screen } from "@testing-library/react";
import { latestOnsInflationRelease } from "finance-inflation-indices/dataset";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { RealGrossSalaryHistory } from "@/components/assettracker/real-gross-salary-history";
import type { SalaryHistoryRecord } from "@/lib/domain/assettracker";

const latestCpihRelease = latestOnsInflationRelease("CPIH");
if (latestCpihRelease == null) {
  throw new Error("The bundled CPIH release is required by this test");
}

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  LineChart: ({ children, data }: { children: ReactNode; data: unknown[] }) => (
    <div data-chart-data={JSON.stringify(data)} data-testid="salary-chart">
      {children}
    </div>
  ),
  Line: ({
    dataKey,
    strokeDasharray,
    type,
  }: {
    dataKey: string;
    strokeDasharray?: string;
    type: string;
  }) => (
    <div
      data-line-type={type}
      data-series={dataKey}
      data-stroke-dasharray={strokeDasharray}
    />
  ),
  CartesianGrid: () => null,
  Legend: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

function salaryRecord(
  overrides: Partial<SalaryHistoryRecord> = {},
): SalaryHistoryRecord {
  return {
    id: "salary-2024",
    person: "Alex",
    employer: "Example Ltd",
    employmentId: "example",
    currency: "GBP",
    jurisdiction: "England",
    effectiveStart: "2024-04-01",
    effectiveEnd: "2025-03-31",
    payFrequency: "monthly",
    amountKind: "annualSalary",
    grossPay: 60_000,
    source: { kind: "manual" },
    acceptedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("RealGrossSalaryHistory", () => {
  it("plots salary facts and exposes the calculation table and controls", () => {
    render(<RealGrossSalaryHistory salaryHistory={[salaryRecord()]} />);

    expect(screen.getByText("Gross salary over time")).toBeVisible();
    expect(
      screen.getByRole("img", {
        name: "Nominal and inflation-adjusted annual salary rate for Alex",
      }),
    ).toBeVisible();
    expect(screen.getByLabelText("Salary inflation index")).toHaveTextContent(
      "CPIH",
    );
    expect(screen.getByLabelText("Salary reference month")).toHaveValue(
      latestCpihRelease.source.coverageThrough,
    );
    expect(screen.getByText("£60,000")).toBeVisible();
    expect(
      screen.getByText(
        new RegExp(
          `Dataset ${latestCpihRelease.versionId.replaceAll(".", "\\.")}`,
        ),
      ),
    ).toBeVisible();
    expect(screen.getByText(/Salary fact salary-2024/)).toBeVisible();
  });

  it("recalculates the table for another reference month", () => {
    render(<RealGrossSalaryHistory salaryHistory={[salaryRecord()]} />);
    const latestRealValue = screen.getAllByText(/^£[\d,]+$/)[1]?.textContent;

    fireEvent.change(screen.getByLabelText("Salary reference month"), {
      target: { value: "2024-04" },
    });

    expect(screen.getByLabelText("Salary reference month")).toHaveValue(
      "2024-04",
    );
    expect(screen.getAllByText(/^£[\d,]+$/)[1]?.textContent).not.toBe(
      latestRealValue,
    );

    fireEvent.change(screen.getByLabelText("Salary reference month"), {
      target: { value: "" },
    });
    expect(screen.getByLabelText("Salary reference month")).toHaveValue(
      "2024-04",
    );
  });

  it("interpolates known facts and toggles chart series from the legend", () => {
    const { container } = render(
      <RealGrossSalaryHistory
        salaryHistory={[
          salaryRecord(),
          salaryRecord({
            id: "salary-2025",
            effectiveStart: "2025-04-01",
            effectiveEnd: "2026-03-31",
            grossPay: 65_000,
          }),
        ]}
      />,
    );

    expect(
      container.querySelector('[data-series="nominalGross"]'),
    ).toHaveAttribute("data-line-type", "linear");
    expect(
      container.querySelector('[data-series="realGross"]'),
    ).toHaveAttribute("data-line-type", "linear");

    const nominal = screen.getByRole("button", { name: "Nominal gross pay" });
    const real = screen.getByRole("button", {
      name: "Inflation-adjusted gross pay",
    });
    expect(nominal).toHaveAttribute("aria-pressed", "true");
    expect(real).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(nominal);
    expect(nominal).toHaveAttribute("aria-pressed", "false");
    expect(container.querySelector('[data-series="nominalGross"]')).toBeNull();
    expect(container.querySelector('[data-series="realGross"]')).toBeVisible();

    fireEvent.click(nominal);
    fireEvent.click(real);
    expect(
      container.querySelector('[data-series="nominalGross"]'),
    ).toBeVisible();
    expect(container.querySelector('[data-series="realGross"]')).toBeNull();
  });

  it("marks an open-ended salary carried to the reference month as assumed", () => {
    const { container } = render(
      <RealGrossSalaryHistory
        salaryHistory={[salaryRecord({ effectiveEnd: undefined })]}
      />,
    );
    const chart = screen.getByTestId("salary-chart");
    const chartData = JSON.parse(chart.dataset.chartData ?? "[]");

    expect(chartData).toEqual([
      expect.objectContaining({
        id: "salary-2024",
        nominalGross: 60_000,
        assumedNominalGross: 60_000,
      }),
      expect.objectContaining({
        id: "salary-2024:assumed",
        date: `${latestCpihRelease.source.coverageThrough}-01`,
        assumedNominalGross: 60_000,
        assumedRealGross: 60_000,
      }),
    ]);
    expect(
      container.querySelector('[data-series="assumedNominalGross"]'),
    ).toHaveAttribute("data-stroke-dasharray", "6 4");
    expect(
      screen.getByText(/Dashed segments assume the latest open-ended salary/),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Nominal gross pay" }));
    expect(container.querySelector('[data-series="nominalGross"]')).toBeNull();
    expect(
      container.querySelector('[data-series="assumedNominalGross"]'),
    ).toBeNull();
    expect(container.querySelector('[data-series="realGross"]')).toBeVisible();
    expect(
      container.querySelector('[data-series="assumedRealGross"]'),
    ).toBeVisible();
  });

  it("keeps non-GBP salary facts visible as unavailable", () => {
    render(
      <RealGrossSalaryHistory
        salaryHistory={[salaryRecord({ currency: "USD" })]}
      />,
    );

    expect(screen.getByText(/60,000/)).toBeVisible();
    expect(screen.getByText("Unavailable")).toBeVisible();
    expect(screen.getByText(/cannot adjust USD values/)).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 salary record has no real-terms value",
    );
  });

  it("switches salary basis, person, and inflation index", () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    render(
      <RealGrossSalaryHistory
        salaryHistory={[
          salaryRecord(),
          salaryRecord({
            id: "sam-period-pay",
            person: "Sam",
            amountKind: "periodPay",
            grossPay: 4_000,
          }),
        ]}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText("Salary person"), {
      key: "ArrowDown",
    });
    fireEvent.click(screen.getByRole("option", { name: "Sam" }));
    expect(
      screen.getByText(/No annual salary rate records for Sam/),
    ).toBeVisible();

    fireEvent.keyDown(screen.getByLabelText("Gross salary figure"), {
      key: "ArrowDown",
    });
    fireEvent.click(
      screen.getByRole("option", { name: "Actual period earnings" }),
    );
    expect(screen.getByText("£4,000")).toBeVisible();

    fireEvent.keyDown(screen.getByLabelText("Salary inflation index"), {
      key: "ArrowDown",
    });
    fireEvent.click(screen.getByRole("option", { name: "RPI" }));
    expect(screen.getByText(/RPI is a legacy measure/)).toBeVisible();
  });

  it("links to salary import when no history exists", () => {
    render(<RealGrossSalaryHistory salaryHistory={[]} />);

    expect(screen.getByText("No salary history yet")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Import salary history" }),
    ).toHaveAttribute("href", "/assettracker/imports");
  });
});
